import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"

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

  // 2. Get GitHub token from session
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json(
      { error: "Unauthorized - please sign in with GitHub" },
      { status: 401 }
    )
  }
  const githubToken = session.accessToken

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

    // 6. Set up the remote URL with auth token
    const remoteUrl = `https://x-access-token:${githubToken}@github.com/${repoFullName}.git`

    // Remove existing origin if any, then add the new one
    // Using || true to ignore errors if remote doesn't exist
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote remove origin 2>/dev/null || true`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git remote add origin "${remoteUrl}"`
    )

    // 7. Push to the remote (force push since it's a new repo)
    // The new repo from GitHub has auto_init which creates a README, so we need to force push
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git push -u origin ${branch} --force`
    )

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/setup-remote] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
