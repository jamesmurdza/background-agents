import { Daytona } from "@daytonaio/sdk"
import { createSandboxJobs } from "@background-agents/sandbox-jobs"
import { prisma } from "@/lib/db/prisma"
import {
  internalError,
  isAuthError,
  notFound,
  requireAuth,
} from "@/lib/db/api-helpers"
import { isSetupRunRecord, tailLines, type SetupRunRecord } from "@/lib/setup-script"
import { dispatchQueuedTurn, finishSetupRecord } from "@/lib/server/dispatch-setup-turn"

export const maxDuration = 300

/** Gap between polls. Each poll is intended to also count as sandbox activity,
 *  which would keep autoStopInterval from stopping a sandbox mid-script while a
 *  client watches, but this has not been confirmed against a real Daytona
 *  sandbox. See the "Staging verification checklist" item 1 in
 *  docs/superpowers/specs/2026-09-05-cloud-environments-design.md. */
const POLL_INTERVAL_MS = 1500

/**
 * Streams a chat's setup-script output, then dispatches the queued agent turn.
 *
 * Reads the job log incrementally by byte cursor, so a client that connects
 * late, refreshes, or opens a second device picks up the whole log and then
 * follows along. The job's state lives in the sandbox filesystem, never in
 * this process. That also covers the function's own 5-minute ceiling, which is
 * shorter than SETUP_TIMEOUT_SECONDS: a script that outlives the stream is
 * resumed by a reconnect, and its exit is caught by the cron either way.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { chatId } = await params
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId },
      select: { id: true, sandboxId: true, setupRun: true, status: true },
    })
    if (!chat) return notFound("Chat not found")

    const record = chat.setupRun
    if (!isSetupRunRecord(record) || !chat.sandboxId) {
      return notFound("No setup run for this chat")
    }
    const setupRun = record as SetupRunRecord

    // No handle means no job was ever started (an empty script). Such a chat
    // should never be in `setting_up`, but if one is, nothing can poll it out,
    // so unstick it here rather than leaving the turn queued forever. It still
    // goes out as a `done` event: the client opens this with EventSource, and a
    // JSON body would look like a connection that yields nothing.
    const handle = setupRun.handle

    const daytonaApiKey = process.env.DAYTONA_API_KEY
    if (!daytonaApiKey) return internalError(new Error("DAYTONA_API_KEY not configured"))

    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const jobs = handle
      ? createSandboxJobs(await daytona.get(chat.sandboxId))
      : null

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // Enqueueing to a stream whose client has gone away throws. That is a
        // normal way for this endpoint to end, not an error worth propagating
        // out of the catch below as an unhandled rejection.
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            )
          } catch {
            /* client gone */
          }
        }

        let cursor = 0
        let collected = ""

        try {
          if (!jobs || !handle) {
            const dispatched = await dispatchQueuedTurn({
              chatId,
              userId,
              setupRun: { ...setupRun, state: "exited", exitCode: 0, finishedAt: Date.now() },
              logTail: "",
            })
            send("done", { exitCode: 0, state: "exited", dispatched })
            return // the `finally` below closes the stream
          }

          for (;;) {
            const read = await jobs.read(handle, cursor)
            if (read.raw) {
              collected += read.raw
              cursor = read.cursor
              send("output", { raw: read.raw, cursor })
            }
            if (!read.status.alive) {
              const finished = finishSetupRecord(setupRun, read.status)

              const dispatched = await dispatchQueuedTurn({
                chatId,
                userId,
                setupRun: finished,
                logTail: tailLines(collected),
              })

              send("done", {
                exitCode: read.status.exitCode,
                state: finished.state,
                dispatched,
              })
              break
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          }
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "Setup stream failed",
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    return internalError(error)
  }
}
