import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/daytona-git"
import { PATHS } from "@/lib/constants"
import { requireGitHubAuth, isGitHubAuthError, requireAuth, isAuthError, internalError, badRequest } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, repoName, branch } = body

  if (!sandboxId || !repoName || !branch) {
    return badRequest("Missing required fields: sandboxId, repoName, branch")
  }

  // 2. Get GitHub token from request body first (for API access)
  // Fall back to DB token (for browser access)
  let githubToken = body.githubToken
  let userId: string | undefined
  if (!githubToken) {
    const ghAuth = await requireGitHubAuth()
    if (isGitHubAuthError(ghAuth)) {
      return Response.json({ error: "Unauthorized - provide githubToken in body or sign in" }, { status: 401 })
    }
    githubToken = ghAuth.token
    userId = ghAuth.userId
  } else {
    // If token provided in body, still try to get userId for settings
    const auth = await requireAuth()
    if (!isAuthError(auth)) {
      userId = auth.userId
    }
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
    let enablePrepushHooks = DEFAULT_SETTINGS.enablePrepushHooks
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { settings: true },
      })
      if (user?.settings) {
        const s = user.settings as Partial<Settings>
        enablePrepushHooks = s.enablePrepushHooks ?? DEFAULT_SETTINGS.enablePrepushHooks
      }
    }

    // 5. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
    const git = createSandboxGit(sandbox)

    // 6. Push to remote
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

    await git.push(repoPath, githubToken, { noVerify: !enablePrepushHooks })

    return Response.json({ success: true })
  } catch (error) {
    console.error("[git/push] Error:", error)
    return internalError(error)
  }
}
