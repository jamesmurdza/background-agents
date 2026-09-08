import { Daytona } from "@daytonaio/sdk"
import { createSandboxJobs } from "@background-agents/sandbox-jobs"
import { requireAuth, isAuthError, notFound, internalError, getGitHubToken } from "@/lib/db/api-helpers"
import { getOwnedEnvironment, toResolvedEnvironment } from "@/lib/environments"
import { createSandboxForChat } from "@/lib/sandbox"

export const maxDuration = 300

/** Gap between polls, matching /api/chats/[chatId]/setup. */
const POLL_INTERVAL_MS = 1500

/**
 * Validate a setup script in a throwaway sandbox, without creating a chat.
 *
 * Built as a GET (not the POST the plan sketched) so the editor can drive it
 * with a plain EventSource, the same way the chat's own /setup stream works
 * -- EventSource can't carry a request body, and this route has none to send.
 *
 * The sandbox is built from the environment's own settings (network mode,
 * variables, and the script itself) via the same createSandboxForChat used
 * for real chats, so this proves the script against the conditions it will
 * actually run under rather than some looser stand-in. It streams the job's
 * output with the same SSE event shape as /api/chats/[chatId]/setup so the
 * client can reuse that route's log-panel rendering.
 *
 * The sandbox this creates is throwaway by construction and is deleted on
 * every exit path: a script failure, a thrown error mid-stream, and the
 * ordinary success case all fall through to the same cleanup.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const row = await getOwnedEnvironment(userId, id)
    if (!row) return notFound("Environment not found")

    const environment = toResolvedEnvironment(row)
    if (!environment.setupScript?.trim()) return notFound("This environment has no setup script")

    const daytonaApiKey = process.env.DAYTONA_API_KEY
    if (!daytonaApiKey) return internalError(new Error("DAYTONA_API_KEY not configured"))

    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const githubToken = await getGitHubToken(userId)

    // createSandboxForChat deletes the sandbox itself if bring-up fails (clone,
    // branch setup, or the script's own write/start): see its own try/catch.
    // From here on the sandbox exists and this route is the one that owns it.
    const created = await createSandboxForChat({
      daytona,
      repo: environment.repo,
      baseBranch: "main",
      newBranch: `setup-check/${Date.now()}`,
      githubToken: githubToken ?? undefined,
      userId,
      environment,
    })

    const deleteThrowaway = async (): Promise<void> => {
      try {
        await created.sandbox.delete()
      } catch (err) {
        console.error("[run-setup] Failed to delete throwaway sandbox:", err)
      }
    }

    // Guaranteed by the non-empty-script check above (createSandboxForChat
    // always starts a job for a non-blank script), but don't leave a sandbox
    // behind if that invariant is ever wrong.
    const handle = created.setupRun?.handle
    if (!handle) {
      await deleteThrowaway()
      return internalError(new Error("Setup script did not start"))
    }

    const jobs = createSandboxJobs(created.sandbox)
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          } catch {
            /* client gone */
          }
        }

        let cursor = 0
        try {
          for (;;) {
            const read = await jobs.read(handle, cursor)
            if (read.raw) {
              cursor = read.cursor
              send("output", { raw: read.raw, cursor })
            }
            if (!read.status.alive) {
              send("done", { exitCode: read.status.exitCode, state: read.status.state })
              break
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          }
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : "Run failed" })
        } finally {
          // Throwaway by construction: this sandbox existed only to prove the
          // script one way or the other. Delete it regardless of outcome.
          await deleteThrowaway()
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
