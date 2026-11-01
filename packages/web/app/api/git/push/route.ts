import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/sandbox-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError, requireAuth, isAuthError, internalError, badRequest, verifySandboxOwnership, forbidden, serverConfigError } from "@/lib/db/api-helpers"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { getUserPushOptions } from "@/lib/git/push-options"

export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, repoName, branch } = body

  if (!sandboxId || !repoName || !branch) {
    return badRequest("Missing required fields: sandboxId, repoName, branch")
  }

  // 2. Require a session and verify sandbox ownership before operating on it.
  // A body-supplied githubToken must NOT bypass this — otherwise any caller with
  // some GitHub token could run git operations inside another user's sandbox.
  const auth = await requireAuth()
  if (isAuthError(auth)) {
    return Response.json({ error: "Unauthorized - sign in to push" }, { status: 401 })
  }
  const userId = auth.userId

  if (!(await verifySandboxOwnership(userId, sandboxId))) {
    return forbidden()
  }

  // GitHub token: honor a body-provided token (API access), else the DB token.
  let githubToken = body.githubToken
  if (!githubToken) {
    const ghAuth = await requireGitHubAuth()
    if (isGitHubAuthError(ghAuth)) {
      return Response.json({ error: "Unauthorized - provide githubToken in body or link GitHub" }, { status: 401 })
    }
    githubToken = ghAuth.token
  }

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  try {
    // 4. Get user settings for push options
    const pushOptions = await getUserPushOptions(userId)

    // 5. Get sandbox from Daytona. This push can only push whatever commits
    // exist in the sandbox's local working tree — if the sandbox expired,
    // that local state is already gone and recreating it (a fresh clone of
    // whatever's already on the remote) can't recover it. Unlike the git
    // actions in /api/sandbox/git, there's nothing safe to retry here, so we
    // just classify the failure clearly instead of silently recreating and
    // reporting a misleading "success" for a push that pushed nothing new.
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandboxOrExpired = await getSandboxOrExpired(daytona, sandboxId)
    if (sandboxOrExpired instanceof Response) return sandboxOrExpired
    const sandbox = sandboxOrExpired
    const git = createSandboxGit(sandbox)

    // 6. Push to remote
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

    await git.push(repoPath, githubToken, pushOptions)

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/push] Error:", error)
    return internalError(error)
  }
}
