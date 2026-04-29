import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
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

/**
 * Auto-push to remote after agent completion
 * Returns true if push succeeded, false otherwise
 */
async function autoPush(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  githubToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await sandbox.git.push(repoPath, "x-access-token", githubToken)
    return { success: true }
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
  const sandboxId = url.searchParams.get("sandboxId")
  const repoName = url.searchParams.get("repoName")
  const previewUrlPattern = url.searchParams.get("previewUrlPattern")
  const backgroundSessionId = url.searchParams.get("backgroundSessionId")
  const cursorParam = url.searchParams.get("cursor")
  const chatId = url.searchParams.get("chatId")
  const assistantMessageId = url.searchParams.get("assistantMessageId")

  if (!sandboxId || !repoName || !backgroundSessionId) {
    return jsonResponse(400, {
      error: "Missing required fields: sandboxId, repoName, backgroundSessionId",
    })
  }

  const auth = await requireChatStreamAccess(chatId, assistantMessageId)
  if (isAuthError(auth)) return auth

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return jsonResponse(500, { error: "Daytona API key not configured" })
  }

  const encoder = new TextEncoder()
  let isStreamClosed = false
  // Store sandbox reference for use in cancel() callback
  let sandboxRef: Awaited<ReturnType<Daytona["get"]>> | null = null
  let sessionOptsRef: { repoPath: string; previewUrlPattern?: string } | null = null

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
        } catch {
          isStreamClosed = true
        }
      }

      // Persist a snapshot to the DB. The snapshot is the source of truth —
      // the route never holds a separate accumulator that could drift.
      const persistSnapshot = async (snap: AgentSnapshot, isFinal: boolean) => {
        if (!chatId || !assistantMessageId) return
        try {
          await prisma.message.update({
            where: { id: assistantMessageId },
            data: {
              content: snap.content,
              toolCalls:
                snap.toolCalls.length > 0
                  ? (snap.toolCalls as unknown as Prisma.InputJsonValue)
                  : undefined,
              contentBlocks:
                snap.contentBlocks.length > 0
                  ? (snap.contentBlocks as unknown as Prisma.InputJsonValue)
                  : undefined,
            },
          })

          if (isFinal) {
            await prisma.chat.update({
              where: { id: chatId },
              data: {
                lastActiveAt: new Date(),
                status: snap.status === "error" ? "error" : "ready",
                backgroundSessionId: null,
                sessionId: snap.sessionId || undefined,
              },
            })
          }

          lastDbPersist = Date.now()
        } catch (error) {
          console.error("[agent/stream] DB persist error:", error)
        }
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
        // Store refs for cancel() callback
        sandboxRef = sandbox
        sessionOptsRef = sessionOpts

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

          const sig = `${lastSnap.status}|${lastSnap.content.length}|${lastSnap.toolCalls.length}|${lastSnap.contentBlocks.length}|${lastSnap.error ?? ""}`
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
            await persistSnapshot(lastSnap, true)
            await finalizeTurn(sandbox, backgroundSessionId, sessionOpts)

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
                  const pushResult = await autoPush(
                    sandbox,
                    sessionOpts.repoPath,
                    account.access_token
                  )

                  if (!pushResult.success) {
                    // Create error message with force-push action
                    await createGitOperationMessage(
                      chatId,
                      `Push failed: ${pushResult.error}. You can force push to overwrite the remote history.`,
                      true,
                      { action: "force-push" }
                    )
                  }
                }
              }
            }

            sendEvent("complete", {
              status: lastSnap.status,
              sessionId: lastSnap.sessionId,
              error: lastSnap.error,
              cursor,
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

    async cancel() {
      isStreamClosed = true
      // Kill the agent process and update DB status
      if (sandboxRef && sessionOptsRef) {
        await cancelBackgroundAgent(sandboxRef, backgroundSessionId, sessionOptsRef)
      }
      if (chatId) {
        try {
          await prisma.chat.update({
            where: { id: chatId },
            data: { status: "ready", backgroundSessionId: null },
          })
        } catch {
          /* best effort */
        }
      }
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
