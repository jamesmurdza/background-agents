import { createHash } from "node:crypto"
import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/sandbox-git"
import { PATHS } from "@/lib/constants"
import {
  cancelBackgroundAgent,
  finalizeTurn,
  formatAgentError,
  snapshotBackgroundAgent,
  type AgentSnapshot,
} from "@/lib/agent-session"
import { prisma } from "@/lib/db/prisma"
import { isAuthError, requireChatStreamAccess } from "@/lib/db/api-helpers"
import { createGitOperationMessage } from "@/lib/db/git-messages"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { getUserPushOptions } from "@/lib/git/push-options"
import { persistAgentSnapshot } from "./_lib/persist-snapshot"

/**
 * Check if the repository is in a conflict state (merge or rebase in progress)
 */
async function isInConflictState(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string
): Promise<boolean> {
  try {
    // Check for rebase in progress
    const rebaseCheck = await sandbox.process.executeCommand(
      `test -d ${repoPath}/.git/rebase-merge -o -d ${repoPath}/.git/rebase-apply && echo "yes" || echo "no"`
    )
    if (rebaseCheck.result.trim() === "yes") {
      return true
    }

    // Check for merge in progress
    const mergeHeadCheck = await sandbox.process.executeCommand(
      `test -f ${repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
    )
    if (mergeHeadCheck.result.trim() === "yes") {
      return true
    }

    return false
  } catch {
    // If we can't determine conflict state, assume no conflict
    return false
  }
}

/**
 * Auto-push to remote after agent completion
 * Returns true if push succeeded, false otherwise
 */
async function autoPush(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  githubToken: string,
  options?: { noVerify?: boolean }
): Promise<{
  success: boolean
  error?: string
  skipped?: boolean
  /** True when the push actually advanced the remote (something was delivered) */
  pushed?: boolean
  /** Best-effort number of commits delivered (0 when unknown) */
  pushedCommits?: number
  branch?: string
  commitSha?: string
}> {
  try {
    // Skip auto-push if in conflict state (merge or rebase in progress)
    const inConflict = await isInConflictState(sandbox, repoPath)
    if (inConflict) {
      return { success: true, skipped: true }
    }

    // Current branch name (best-effort).
    const branchRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""`
    )
    const branch = branchRes.result.trim()

    const git = createSandboxGit(sandbox)
    // The push result is the source of truth for "did anything get pushed":
    // `--porcelain` reports whether the remote ref advanced or was up-to-date.
    const pushResult = await git.push(repoPath, githubToken, { noVerify: options?.noVerify })

    const headRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-parse --short HEAD 2>/dev/null || echo ""`
    )
    const commitSha = headRes.result.trim()

    // Best-effort commit count for display. When the push reported an exact
    // "<old>..<new>" range (existing branch), count that; otherwise fall back
    // to commits not on any origin remote-tracking branch. Either way the
    // notification is gated on `pushed`, not on this number.
    let pushedCommits = 0
    if (pushResult.updated) {
      const range = pushResult.range ?? "HEAD --not --remotes=origin"
      const countRes = await sandbox.process.executeCommand(
        `cd ${repoPath} && git rev-list --count ${range} 2>/dev/null || echo 0`
      )
      pushedCommits = parseInt(countRes.result.trim() || "0", 10) || 0
    }

    return { success: true, pushed: pushResult.updated, pushedCommits, branch, commitSha }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return { success: false, error: message }
  }
}

// Allow longer streaming connections (5 minutes max)
export const maxDuration = 300

const BACKEND_POLL_INTERVAL = 500
const HEARTBEAT_INTERVAL = 15000
const DB_PERSIST_INTERVAL = 5000

const jsonResponse = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const cursorParam = url.searchParams.get("cursor")
  const chatId = url.searchParams.get("chatId")
  const assistantMessageId = url.searchParams.get("assistantMessageId")

  const auth = await requireChatStreamAccess(chatId, assistantMessageId)
  if (isAuthError(auth)) return auth

  // IDOR fix: derive sandbox/session/preview from the *chat row* we just
  // authorized, NOT from query params. Previously the route used
  // url.searchParams.get("sandboxId" / "backgroundSessionId" / ...) which any
  // authenticated user could overwrite with another user's sandbox id —
  // Daytona uses one app-wide API key (single org) so daytona.get(foreignId)
  // would succeed. See packages/web/e2e tests for reproduction.
  const { chat } = auth
  const sandboxId = chat.sandboxId
  const backgroundSessionId = chat.backgroundSessionId
  const previewUrlPattern = chat.previewUrlPattern
  // The sandbox clone directory is fixed per app convention; the client
  // always passed "project" anyway, so the value lives here now.
  const repoName = "project"

  if (!sandboxId || !backgroundSessionId) {
    return jsonResponse(400, {
      error: "Chat has no active sandbox or background session",
    })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return jsonResponse(500, { error: "Daytona API key not configured" })
  }

  const encoder = new TextEncoder()
  let isStreamClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      // SSE poll-counter, bumped per wire frame for client reconnect bookkeeping.
      let cursor = cursorParam ? parseInt(cursorParam, 10) : 0
      let heartbeatTimer: NodeJS.Timeout | null = null
      let lastDbPersist = Date.now()
      // Signature of the last "update" sent — skip resends when the snapshot
      // hasn't changed.
      let lastSentSig: string | null = null

      const sendEvent = (event: string, data: object) => {
        if (isStreamClosed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch (err) {
          console.error("[agent/stream] sendEvent failed, marking stream closed:", err)
          isStreamClosed = true
        }
      }

      // Persist a snapshot to the DB. The snapshot is the source of truth —
      // the route never holds a separate accumulator that could drift.
      //
      // The message body and the chat-status reset are persisted independently
      // (see persistAgentSnapshot): on a final write the chat MUST be released
      // from "running" even if the message body write fails, otherwise the chat
      // is stranded as permanently busy.
      const persistSnapshot = async (snap: AgentSnapshot, isFinal: boolean) => {
        if (!chatId || !assistantMessageId) return
        await persistAgentSnapshot({
          prisma,
          chatId,
          assistantMessageId,
          snapshot: snap,
          isFinal,
        })
        lastDbPersist = Date.now()
      }

      const closeStream = () => {
        isStreamClosed = true
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      try {
        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.get(sandboxId)
        const sessionOpts = {
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          previewUrlPattern: previewUrlPattern || undefined,
        }

        heartbeatTimer = setInterval(() => {
          sendEvent("heartbeat", { cursor, timestamp: Date.now() })
        }, HEARTBEAT_INTERVAL)

        // Each iteration: take a cumulative snapshot of the agent's event log
        // (source of truth = file in the sandbox), send it to the client, and
        // periodically persist it to the DB. The route holds NO accumulator
        // state — the snapshot is re-derived from the file each time, so a
        // new SSE connection (reconnect) automatically reconstructs full state.
        let lastSnap: AgentSnapshot | null = null
        while (!isStreamClosed) {
          lastSnap = await snapshotBackgroundAgent(
            sandbox,
            backgroundSessionId,
            sessionOpts
          )

          // Hash the full wire payload so any mutation that would change
          // what we'd send (including in-place tool_end output attachment,
          // see buildContentBlocks) changes the signature. The previous
          // length-tuple version skipped tool_end updates because tool
          // output is attached in place without changing any array length.
          const sig = createHash("sha1")
            .update(
              JSON.stringify({
                status: lastSnap.status,
                content: lastSnap.content,
                toolCalls: lastSnap.toolCalls,
                contentBlocks: lastSnap.contentBlocks,
                error: lastSnap.error ?? "",
              })
            )
            .digest("hex")
          if (sig !== lastSentSig) {
            lastSentSig = sig
            cursor += 1
            sendEvent("update", {
              status: lastSnap.status,
              content: lastSnap.content,
              toolCalls: lastSnap.toolCalls,
              contentBlocks: lastSnap.contentBlocks,
              cursor,
              sessionId: lastSnap.sessionId,
              error: lastSnap.error,
            })
          }

          if (lastSnap.status === "completed" || lastSnap.status === "error") {
            // A turn can end in "error" while its process is still alive — most
            // notably OpenCode, which on a retryable model error (rate/usage
            // limit, overload) retries with unbounded backoff. The snapshot
            // surfaces that error, but the process keeps running and would
            // linger as an orphan until the sandbox is torn down. Reap it.
            // Best-effort and idempotent: a no-op when the process already
            // exited (the common completed/crashed case).
            if (lastSnap.status === "error") {
              await cancelBackgroundAgent(sandbox, backgroundSessionId, sessionOpts)
            }

            await persistSnapshot(lastSnap, true)
            await finalizeTurn(sandbox, backgroundSessionId, sessionOpts)

            // Meter token/cost usage via tokscale while the sandbox is still
            // alive (best-effort). This is the live-stream completion path; the
            // agent-lifecycle cron only meters turns that finish without a
            // connected stream. Attribution comes from the assistant message
            // stamped at send time.
            if (chatId && assistantMessageId && lastSnap.sessionId) {
              try {
                const [chatRow, asstMsg] = await Promise.all([
                  prisma.chat.findUnique({
                    where: { id: chatId },
                    select: { userId: true, agent: true },
                  }),
                  prisma.message.findUnique({
                    where: { id: assistantMessageId },
                    select: { metadata: true },
                  }),
                ])
                if (chatRow) {
                  await meterAssistantTurn(sandbox, {
                    userId: chatRow.userId,
                    chatId,
                    messageId: assistantMessageId,
                    messageMetadata: asstMsg?.metadata,
                    agent: chatRow.agent,
                    sessionId: lastSnap.sessionId,
                  })
                }
              } catch (err) {
                console.error("[agent/stream] meterAssistantTurn failed:", err)
              }
            }

            // Populated when the auto-push below delivers new commits, so the
            // client can raise a "new push" notification.
            let pushInfo: { branch: string; commits: number; commitSha?: string } | undefined

            // Auto-push on successful completion if chat has a branch (GitHub repo)
            if (lastSnap.status === "completed" && chatId) {
              const chat = await prisma.chat.findUnique({
                where: { id: chatId },
                select: { branch: true, repo: true, userId: true },
              })

              if (chat?.branch && chat.repo && chat.repo !== "__new__") {
                // Get GitHub token from user's account
                const account = await prisma.account.findFirst({
                  where: { userId: chat.userId, provider: "github" },
                  select: { access_token: true },
                })

                if (account?.access_token) {
                  // Get user settings for push options
                  const pushOptions = await getUserPushOptions(chat.userId)

                  const pushResult = await autoPush(
                    sandbox,
                    sessionOpts.repoPath,
                    account.access_token,
                    pushOptions
                  )

                  if (!pushResult.success) {
                    // Create error message with force-push action
                    await createGitOperationMessage(
                      chatId,
                      `Push failed: ${pushResult.error}. You can force push to overwrite the remote history.`,
                      true,
                      { action: "force-push" }
                    )
                  } else if (pushResult.pushed) {
                    // The remote actually advanced — tell the client to notify.
                    pushInfo = {
                      branch: pushResult.branch || chat.branch,
                      commits: pushResult.pushedCommits ?? 0,
                      commitSha: pushResult.commitSha,
                    }
                  }
                }
              }
            }

            // Check conflict state to include in complete event
            // This allows the frontend to update the warning icon after agent resolves conflicts
            let conflictState: { inRebase: boolean; inMerge: boolean; conflictedFiles: string[] } | undefined
            try {
              const rebaseCheck = await sandbox.process.executeCommand(
                `test -d ${sessionOpts.repoPath}/.git/rebase-merge -o -d ${sessionOpts.repoPath}/.git/rebase-apply && echo "yes" || echo "no"`
              )
              const inRebase = rebaseCheck.result.trim() === "yes"

              const mergeHeadCheck = await sandbox.process.executeCommand(
                `test -f ${sessionOpts.repoPath}/.git/MERGE_HEAD && echo "yes" || echo "no"`
              )
              const inMerge = mergeHeadCheck.result.trim() === "yes"

              let conflictedFiles: string[] = []
              if (inRebase || inMerge) {
                const conflictResult = await sandbox.process.executeCommand(
                  `cd ${sessionOpts.repoPath} && git diff --name-only --diff-filter=U 2>&1`
                )
                conflictedFiles = conflictResult.result.trim().split("\n").filter(Boolean)
              }

              conflictState = { inRebase, inMerge, conflictedFiles }
            } catch {
              // Best effort - don't fail the complete event if we can't check conflict state
            }

            sendEvent("complete", {
              status: lastSnap.status,
              sessionId: lastSnap.sessionId,
              error: lastSnap.error,
              errorKind: lastSnap.errorKind,
              cursor,
              conflictState,
              push: pushInfo,
            })
            closeStream()
            return
          }

          if (Date.now() - lastDbPersist >= DB_PERSIST_INTERVAL) {
            await persistSnapshot(lastSnap, false)
          }

          if (isStreamClosed) break

          await new Promise((resolve) =>
            setTimeout(resolve, BACKEND_POLL_INTERVAL)
          )
        }

        // Client disconnected - flush last known state
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        if (lastSnap) {
          await persistSnapshot(lastSnap, false)
        }
      } catch (error) {
        console.error("[agent/stream] Error:", error)
        const message = formatAgentError(error)

        if (chatId) {
          try {
            await prisma.chat.update({
              where: { id: chatId },
              data: { status: "error", backgroundSessionId: null },
            })
          } catch {
            /* best effort */
          }
        }

        sendEvent("error", { error: message, cursor })
        closeStream()
      }
    },

    cancel() {
      // Stream cancelled (client disconnected, browser closed, network issue, etc.)
      // We intentionally do NOT stop the agent here - the agent should keep running
      // in the background so the user can reconnect later.
      // Use POST /api/agent/stop to explicitly stop an agent.
      isStreamClosed = true
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
