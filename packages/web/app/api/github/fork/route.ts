import { forkRepo, getRepo, type GitHubRepo } from "@upstream/common"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"

export async function POST(req: Request) {
  // 1. Get GitHub token from DB
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  // 2. Parse request body
  const body = await req.json()
  const { owner, repo } = body

  if (!owner || typeof owner !== "string") {
    return Response.json(
      { error: "Repository owner is required" },
      { status: 400 }
    )
  }

  if (!repo || typeof repo !== "string") {
    return Response.json(
      { error: "Repository name is required" },
      { status: 400 }
    )
  }

  try {
    // 3. Fork the repository
    const forkedRepo: GitHubRepo = await forkRepo(ghAuth.token, owner, repo)

    // 4. Wait for fork to be ready (GitHub forks are async)
    // Poll the forked repo until it exists
    let attempts = 0
    const maxAttempts = 30 // 30 seconds max
    let readyRepo: GitHubRepo | null = null

    while (attempts < maxAttempts) {
      try {
        readyRepo = await getRepo(ghAuth.token, forkedRepo.owner.login, forkedRepo.name)
        // Check if the repo has content (default_branch exists)
        if (readyRepo.default_branch) {
          break
        }
      } catch {
        // Repo not ready yet, continue polling
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
      attempts++
    }

    if (!readyRepo) {
      // Return the fork info even if not fully ready - it will be available shortly
      readyRepo = forkedRepo
    }

    // 5. Return the forked repository details
    return Response.json({
      name: readyRepo.name,
      full_name: readyRepo.full_name,
      owner: readyRepo.owner,
      default_branch: readyRepo.default_branch,
      private: readyRepo.private,
    })
  } catch (error) {
    console.error("[github/fork] Error:", error)

    // Handle specific GitHub errors
    if (error && typeof error === "object" && "status" in error) {
      const ghError = error as { message: string; status: number }
      if (ghError.status === 404) {
        return Response.json(
          { error: "Repository not found" },
          { status: 404 }
        )
      }
      if (ghError.status === 403) {
        return Response.json(
          { error: "You don't have permission to fork this repository" },
          { status: 403 }
        )
      }
      return Response.json(
        { error: ghError.message || "Failed to fork repository" },
        { status: ghError.status }
      )
    }

    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
