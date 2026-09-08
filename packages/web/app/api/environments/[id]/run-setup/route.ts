import { Daytona } from "@daytonaio/sdk"
import { createSandboxJobs } from "@background-agents/sandbox-jobs"
import { getRepo } from "@background-agents/common"
import {
  requireAuth,
  isAuthError,
  notFound,
  forbidden,
  internalError,
  getGitHubToken,
} from "@/lib/db/api-helpers"
import { getOwnedEnvironment, toResolvedEnvironment } from "@/lib/environments"
import { createSandboxForChat } from "@/lib/sandbox"
import { VALIDATION_SETUP_TIMEOUT_SECONDS } from "@/lib/setup-paths"

export const maxDuration = 300

/** Gap between polls, matching /api/chats/[chatId]/setup. */
const POLL_INTERVAL_MS = 1500

/**
 * Auto-delete window for the throwaway validation sandbox, in minutes. Not a
 * cleanup mechanism on its own (the route's own `finally` deletes the
 * sandbox the moment the run ends) but a backstop for the one case that
 * `finally` can't reach: this route's own invocation getting killed at
 * `maxDuration` before it runs. See VALIDATION_SETUP_TIMEOUT_SECONDS for the
 * other half of that fix (capping the script so this rarely matters at all).
 * The sandbox auto-stops after 5 idle minutes (see buildSandboxCreateParams),
 * then this many minutes after that it's deleted -- so worst case this
 * bounds the leak to well under half an hour, not four days.
 */
const THROWAWAY_AUTO_DELETE_MINUTES = 15

/**
 * Validate a setup script in a throwaway sandbox, without creating a chat.
 *
 * Built as a GET (not the POST the plan sketched) so the editor can drive it
 * with a plain EventSource, the same way the chat's own /setup stream works:
 * EventSource can't carry a request body, and this route has none to send.
 * A GET that creates and bills a sandbox is a real side effect an ordinary
 * cross-site link could trigger against a signed-in victim (the session
 * cookie is sameSite=lax, which IS sent on a top-level cross-site
 * navigation), so this checks Sec-Fetch-Site as defence in depth -- it is
 * NOT a CSRF token and doesn't claim to be one, just a cheap way to tell "the
 * app's own EventSource" (same-origin) from "a link on someone else's page"
 * (cross-site) before doing anything that costs money.
 *
 * The sandbox is built from the environment's own settings (network mode,
 * variables, and the script itself) via the same createSandboxForChat used
 * for real chats, so this proves the script against the conditions it will
 * actually run under rather than some looser stand-in. It streams the job's
 * output with the same SSE event shape as /api/chats/[chatId]/setup so the
 * client can reuse that route's log-panel rendering.
 *
 * The sandbox this creates is throwaway by construction and is deleted on
 * every exit path this route controls: a script failure, a thrown error
 * mid-stream, and the ordinary success case all fall through to the same
 * `finally`. The one path outside its control is this invocation itself
 * being killed at `maxDuration` (300s) -- covered by capping the script's own
 * timeout well under that (VALIDATION_SETUP_TIMEOUT_SECONDS) so it cannot
 * still be running when the platform pulls the plug, plus a short
 * auto-delete window on the sandbox itself as a backstop if that ever fails.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Same-origin only: the app's own EventSource sends "same-origin"; a link
  // on another site navigated to (or embedded from) elsewhere sends
  // "cross-site". Browsers that don't send Sec-Fetch-Site at all are old
  // enough to not run this UI's EventSource-based flow either, so treat a
  // missing header the same as a mismatched one rather than trusting it.
  if (req.headers.get("sec-fetch-site") !== "same-origin") {
    return forbidden("This endpoint can only be called from the app itself")
  }

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

    // Environments only ever attach to a real "owner/repo" (never
    // NEW_REPOSITORY), so this is always a real clone target whose actual
    // default branch may not be "main". Resolved the same way the app
    // already resolves it elsewhere (repo.default_branch from GitHub);
    // falls back to "main" if the lookup fails so a transient GitHub error
    // degrades to the old behavior instead of blocking the whole run.
    const [owner, repoName] = environment.repo.split("/")
    let baseBranch = "main"
    if (githubToken && owner && repoName) {
      try {
        const repo = await getRepo(githubToken, owner, repoName)
        baseBranch = repo.default_branch || "main"
      } catch {
        /* fall back to "main"; createSandboxForChat will surface a clearer
         * error itself if the repo can't be reached at all */
      }
    }

    // createSandboxForChat deletes the sandbox itself if bring-up fails (clone,
    // branch setup, or the script's own write/start): see its own try/catch.
    // From here on the sandbox exists and this route is the one that owns it.
    const created = await createSandboxForChat({
      daytona,
      repo: environment.repo,
      baseBranch,
      newBranch: `setup-check/${Date.now()}`,
      githubToken: githubToken ?? undefined,
      userId,
      environment,
      setupScriptTimeoutSeconds: VALIDATION_SETUP_TIMEOUT_SECONDS,
      autoDeleteIntervalMinutes: THROWAWAY_AUTO_DELETE_MINUTES,
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
