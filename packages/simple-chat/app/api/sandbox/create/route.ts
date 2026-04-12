import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"

export const maxDuration = 300 // 5 minutes

export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { repo, baseBranch, newBranch } = body

  if (!repo) {
    return Response.json({ error: "Missing required field: repo" }, { status: 400 })
  }
  if (!newBranch) {
    return Response.json({ error: "Missing required field: newBranch" }, { status: 400 })
  }

  const isNewRepo = repo === NEW_REPOSITORY || repo === "__new__"

  // 2. For GitHub repos, we need auth - accept token from body OR session
  let githubToken: string | undefined
  let owner: string | undefined
  let repoApiName: string | undefined

  // Always use "project" as the directory name for simplicity
  const repoName = "project"

  if (isNewRepo) {
    // No additional setup needed for new repos
  } else {
    // Try to get GitHub token from request body first (for API access)
    // Fall back to session token (for browser access)
    githubToken = body.githubToken
    if (!githubToken) {
      const session = await getServerSession(authOptions)
      if (!session?.accessToken) {
        return Response.json({ error: "Unauthorized - provide githubToken in body or sign in" }, { status: 401 })
      }
      githubToken = session.accessToken
    }

    const parts = repo.split("/")
    owner = parts[0]
    repoApiName = parts[1]
    if (!owner || !repoApiName) {
      return Response.json({ error: "Invalid repo format" }, { status: 400 })
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

  // 4. Get optional API keys from request (OpenCode uses free models by default)
  const anthropicApiKey = body.anthropicApiKey
  const openaiApiKey = body.openaiApiKey

  try {
    // 5. Create Daytona sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })

    // Build env vars - only include keys that are provided
    const envVars: Record<string, string> = {}
    if (anthropicApiKey) {
      envVars.ANTHROPIC_API_KEY = anthropicApiKey
    }
    if (openaiApiKey) {
      envVars.OPENAI_API_KEY = openaiApiKey
    }

    const sandbox = await daytona.create({
      snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
      autoStopInterval: 10, // 10 minutes
      public: true,
      labels: {
        [SANDBOX_CONFIG.LABEL_KEY]: "true",
        repo: isNewRepo ? NEW_REPOSITORY : `${owner}/${repoApiName}`,
        branch: newBranch,
      },
      ...(Object.keys(envVars).length > 0 && { envVars }),
    })

    // 6. Create logs directory
    await sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

    // 7. Set up the repository
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

    if (isNewRepo) {
      // Create a new empty repository
      await sandbox.process.executeCommand(`mkdir -p ${repoPath}`)
      await sandbox.process.executeCommand(`cd ${repoPath} && git init`)
      await sandbox.process.executeCommand(
        `cd ${repoPath} && git config user.email "agent@simplechat.dev" && git config user.name "Simple Chat Agent"`
      )
      // Create initial commit so we have a branch
      await sandbox.process.executeCommand(
        `cd ${repoPath} && echo "# Project" > README.md && git add . && git commit -m "Initial commit"`
      )
    } else {
      // Clone the GitHub repository
      const cloneUrl = `https://github.com/${owner}/${repoApiName}.git`
      await sandbox.git.clone(
        cloneUrl,
        repoPath,
        baseBranch!,
        undefined,
        "x-access-token",
        githubToken!
      )

      // Set up git author config from GitHub user
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

      // Create and checkout new branch
      await sandbox.git.createBranch(repoPath, newBranch)
      await sandbox.git.checkoutBranch(repoPath, newBranch)
    }

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
      repoName,
      branch: newBranch,
      previewUrlPattern,
    })
  } catch (error) {
    console.error("[sandbox/create] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
