import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"

export const maxDuration = 300 // 5 minutes

export async function POST(req: Request) {
  // 1. Get session and verify auth
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const githubToken = session.accessToken

  // 2. Parse request body
  const body = await req.json()
  const { repo, baseBranch, newBranch } = body

  if (!repo || !baseBranch || !newBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const [owner, repoName] = repo.split("/")
  if (!owner || !repoName) {
    return Response.json({ error: "Invalid repo format" }, { status: 400 })
  }

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  // 4. Get Anthropic API key from request (user provides this)
  const anthropicApiKey = body.anthropicApiKey
  if (!anthropicApiKey) {
    return Response.json(
      { error: "Anthropic API key required" },
      { status: 400 }
    )
  }

  try {
    // 5. Create Daytona sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })

    const sandbox = await daytona.create({
      snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
      autoStopInterval: 10, // 10 minutes
      public: true,
      labels: {
        [SANDBOX_CONFIG.LABEL_KEY]: "true",
        repo: `${owner}/${repoName}`,
        branch: newBranch,
      },
      envVars: {
        ANTHROPIC_API_KEY: anthropicApiKey,
      },
    })

    // 6. Create logs directory
    await sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

    // 7. Clone the repository
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
    const cloneUrl = `https://github.com/${owner}/${repoName}.git`

    await sandbox.git.clone(
      cloneUrl,
      repoPath,
      baseBranch,
      undefined,
      "x-access-token",
      githubToken
    )

    // 8. Set up git author config
    let gitName = "Simple Chat Agent"
    let gitEmail = "noreply@example.com"
    try {
      const ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      })
      if (ghRes.ok) {
        const ghUser = await ghRes.json()
        gitName = ghUser.name || ghUser.login
        gitEmail = `${ghUser.login}@users.noreply.github.com`
      }
    } catch {
      // Use defaults
    }
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git config user.email "${gitEmail}" && git config user.name "${gitName}"`
    )

    // 9. Create and checkout new branch
    await sandbox.git.createBranch(repoPath, newBranch)
    await sandbox.git.checkoutBranch(repoPath, newBranch)

    // 10. Get preview URL pattern
    let previewUrlPattern: string | undefined
    try {
      const previewLink = await sandbox.getPreviewLink(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
      previewUrlPattern = previewLink.url.replace(
        String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT),
        "{port}"
      )
    } catch {
      // Preview URLs not available
    }

    return Response.json({
      sandboxId: sandbox.id,
      previewUrlPattern,
    })
  } catch (error) {
    console.error("[sandbox/create] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
