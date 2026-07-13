import { createHash } from "node:crypto"
import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import {
  cancelBackgroundAgent,
  finalizeTurn,
  formatAgentError,
  snapshotBackgroundAgent,
  type AgentSnapshot,
} from "@/lib/agent-session"
import { prisma } from "@/lib/db/prisma"
import { logLlmProviderError } from "@/lib/db/activity-log"
import { isAuthError, requireChatStreamAccess } from "@/lib/db/api-helpers"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { autoPushChat, type PushInfo } from "@/lib/git/auto-push"
import { persistAgentSnapshot } from "./_lib/persist-snapshot"

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

              // Record the provider failure so it's visible in aggregate — we
              // otherwise have no view over which models/providers are failing.
              try {
                const chatRow = chatId
                  ? await prisma.chat.findUnique({
                      where: { id: chatId },
                      select: { agent: true, model: true },
                    })
                  : null
                logLlmProviderError({
                  userId: auth.userId,
                  agent: chatRow?.agent,
                  model: chatRow?.model,
                  chatId: chatId ?? undefined,
                  source: "stream",
                  error: lastSnap.error ?? "Unknown error",
                  errorKind: lastSnap.errorKind,
                })
              } catch (err) {
                console.error("[agent/stream] logLlmProviderError failed:", err)
              }
            }

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

            // Auto-push BEFORE releasing the chat from "running". The push is
            // backend-owned (autoPushChat) — this SSE handler is just a fast
            // trigger for it. Releasing first (backgroundSessionId → null) would
            // exclude the agent-lifecycle cron, so a crash mid-push would strand
            // the commits; pushing first means a dead request simply falls back
            // to the cron, which finalizes identically. Populated when the push
            // advances the remote, so the client can raise a "new push" toast.
            let pushInfo: PushInfo | undefined
            if (lastSnap.status === "completed" && chatId) {
              const chat = await prisma.chat.findUnique({
                where: { id: chatId },
                select: { branch: true, repo: true, userId: true },
              })

              if (chat?.branch && chat.repo && chat.repo !== "__new__") {
                pushInfo =
                  (await autoPushChat({
                    sandbox,
                    repoPath: sessionOpts.repoPath,
                    chatId,
                    userId: chat.userId,
                    branch: chat.branch,
                  })) ?? undefined
              }
            }

            // Now that the push is done, release the chat from "running".
            await persistSnapshot(lastSnap, true)

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
