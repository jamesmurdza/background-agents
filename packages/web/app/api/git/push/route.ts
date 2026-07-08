import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/sandbox-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError, requireAuth, isAuthError, internalError, badRequest, verifySandboxOwnership, forbidden } from "@/lib/db/api-helpers"
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
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    // 4. Get user settings for push options
    const pushOptions = await getUserPushOptions(userId)

    // 5. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
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
