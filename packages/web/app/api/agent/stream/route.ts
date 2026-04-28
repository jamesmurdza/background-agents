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
  // Flag to distinguish intentional stop from accidental disconnect
  let wasIntentionallyCancelled = false
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
        while (!isStreamClosed) {
          const snap = await snapshotBackgroundAgent(
            sandbox,
            backgroundSessionId,
            sessionOpts
          )

          const sig = `${snap.status}|${snap.content.length}|${snap.toolCalls.length}|${snap.contentBlocks.length}|${snap.error ?? ""}`
          if (sig !== lastSentSig) {
            lastSentSig = sig
            cursor += 1
            sendEvent("update", {
              status: snap.status,
              content: snap.content,
              toolCalls: snap.toolCalls,
              contentBlocks: snap.contentBlocks,
              cursor,
              sessionId: snap.sessionId,
              error: snap.error,
            })
          }

          if (snap.status === "completed" || snap.status === "error") {
            // If user intentionally cancelled, treat as completed not error
            const finalStatus = wasIntentionallyCancelled ? "completed" : snap.status
            const finalError = wasIntentionallyCancelled ? undefined : snap.error
            await persistSnapshot({ ...snap, status: finalStatus, error: finalError }, true)
            // Advance the bg session's per-turn meta so the next start()
            // writes to a fresh outputFile.
            await finalizeTurn(sandbox, backgroundSessionId, sessionOpts)
            sendEvent("complete", {
              status: finalStatus,
              sessionId: snap.sessionId,
              error: finalError,
              cursor,
            })
            closeStream()
            return
          }

          if (Date.now() - lastDbPersist >= DB_PERSIST_INTERVAL) {
            await persistSnapshot(snap, false)
          }

          if (isStreamClosed) break

          await new Promise((resolve) =>
            setTimeout(resolve, BACKEND_POLL_INTERVAL)
          )
        }

        // Client disconnected mid-stream.
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        // Take a final snapshot to capture any output produced since last poll.
        try {
          const finalSnap = await snapshotBackgroundAgent(
            sandbox,
            backgroundSessionId,
            sessionOpts
          )
          if (wasIntentionallyCancelled) {
            // User intentionally stopped - save content but mark as completed,
            // not as error. The agent was killed intentionally.
            await persistSnapshot(
              {
                ...finalSnap,
                status: "completed",
                error: undefined,
              },
              true
            )
          } else {
            // Accidental disconnect: flush current state but leave status as
            // running so reconnect will resume.
            await persistSnapshot(finalSnap, false)
          }
        } catch (error) {
          console.error("[agent/stream] disconnect-flush error:", error)
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
      wasIntentionallyCancelled = true
      // Kill the agent process when the client stops.
      // The final snapshot (taken after the loop exits) will persist
      // any output and update the DB status.
      if (sandboxRef && sessionOptsRef) {
        await cancelBackgroundAgent(sandboxRef, backgroundSessionId, sessionOptsRef)
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
