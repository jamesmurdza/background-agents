import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@upstream/daytona-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"

/**
 * Sets up a GitHub remote for an existing local repo in a sandbox and pushes to it.
 * Used when a user creates a new GitHub repo after already starting a chat.
 */
export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, repoFullName, branch } = body

  if (!sandboxId || !repoFullName || !branch) {
    return Response.json(
      { error: "Missing required fields: sandboxId, repoFullName, branch" },
      { status: 400 }
    )
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

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    // 4. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // 5. Always use "project" as the directory name - sandbox/create always uses this
    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // 6. Set up the remote URL (without credentials - token passed per-operation)
    const remoteUrl = `https://github.com/${repoFullName}.git`

    // Remove existing origin if any, then add the new one
    // Using || true to ignore errors if remote doesn't exist
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote remove origin 2>/dev/null || true`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote add origin "${remoteUrl}"`
    )

    // 7. Push to the remote (token passed via -c http.extraHeader, not stored)
    const git = createSandboxGit(sandbox)
    await git.push(repoPath, githubToken)

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/setup-remote] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
