import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit, withAuth } from "@background-agents/sandbox-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError, internalError, badRequest, verifySandboxOwnership, forbidden, serverConfigError } from "@/lib/db/api-helpers"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { getUserPushOptions } from "@/lib/git/push-options"

/**
 * Sets up a GitHub remote for an existing local repo in a sandbox and pushes to it.
 * Used when a user creates a new GitHub repo after already starting a chat.
 */
export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, repoFullName, branch } = body

  if (!sandboxId || !repoFullName || !branch) {
    return badRequest("Missing required fields: sandboxId, repoFullName, branch")
  }

  // 2. Get GitHub token from DB
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) {
    return Response.json(
      { error: "Unauthorized - please sign in with GitHub" },
      { status: 401 }
    )
  }
  const githubToken = ghAuth.token
  const userId = ghAuth.userId

  // Ownership gate: signing in isn't enough — the caller must own this sandbox,
  // otherwise they could point another user's sandbox at their own repo and push
  // that user's working tree to it.
  if (!(await verifySandboxOwnership(userId, sandboxId))) {
    return forbidden()
  }

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  try {
    // 4. Get user settings for push options
    const pushOptions = await getUserPushOptions(userId)

    // 5. Get sandbox from Daytona. This pushes the sandbox's local init
    // commit to seed a brand-new GitHub repo — if the sandbox expired, that
    // local-only commit is already gone and recreating can't bring it back
    // (same reasoning as /api/git/push), so classify clearly instead of
    // silently recreating and reporting success for a no-op push.
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandboxOrExpired = await getSandboxOrExpired(daytona, sandboxId)
    if (sandboxOrExpired instanceof Response) return sandboxOrExpired
    const sandbox = sandboxOrExpired

    // 6. Always use "project" as the directory name - sandbox/create always uses this
    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // 7. Set up the remote URL (without credentials - token passed per-operation)
    const remoteUrl = `https://github.com/${repoFullName}.git`

    // Remove existing origin if any, then add the new one
    // Using || true to ignore errors if remote doesn't exist
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote remove origin 2>/dev/null || true`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote add origin "${remoteUrl}"`
    )

    // 8. This GitHub repo is empty (create-repo never seeds it). Push the
    // sandbox's local `main` — the branch holding its init commit — first, so
    // this push is what creates `main` for the first time. That gives `main`
    // and the working branch a shared ancestor by construction, instead of
    // `main` getting an independently-created history later that the working
    // branch conflicts with on merge.
    const pushMainResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && ${withAuth(githubToken, "push origin main:main")} 2>&1`
    )
    if (pushMainResult.exitCode !== 0) {
      return internalError(new Error(`Failed to push main: ${pushMainResult.result}`))
    }

    // 9. Push the working branch (token passed via -c http.extraHeader, not stored)
    const git = createSandboxGit(sandbox)
    await git.push(repoPath, githubToken, pushOptions)

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/setup-remote] Error:", error)
    return internalError(error)
  }
}
