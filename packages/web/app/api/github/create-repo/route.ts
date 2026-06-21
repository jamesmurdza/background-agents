import { createRepo, createFileCommit, type GitHubRepo } from "@background-agents/common"
import {
  requireGitHubAuth,
  isGitHubAuthError,
  githubErrorResponse,
} from "@/lib/db/api-helpers"

export async function POST(req: Request) {
  // 1. Get GitHub token from DB
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) return ghAuth

  // 2. Parse request body
  const body = await req.json()
  const { name, description, isPrivate } = body

  if (!name || typeof name !== "string") {
    return Response.json(
      { error: "Repository name is required" },
      { status: 400 }
    )
  }

  // Validate repo name format (GitHub rules)
  const nameRegex = /^[a-zA-Z0-9._-]+$/
  if (!nameRegex.test(name)) {
    return Response.json(
      { error: "Repository name can only contain alphanumeric characters, hyphens, underscores, and periods" },
      { status: 400 }
    )
  }

  try {
    // 3. Create the repository
    const repo: GitHubRepo = await createRepo(ghAuth.token, {
      name,
      description: description || undefined,
      isPrivate: isPrivate ?? false,
    })

    // 4. Create initial commit so the default branch exists
    // Without this, the repo is empty and cloning with a branch fails
    await createFileCommit(
      ghAuth.token,
      repo.owner.login,
      repo.name,
      {
        path: "README.md",
        message: "Initial commit",
        content: `# ${name}\n`,
      }
    )

    // 5. Return the created repository details
    return Response.json({
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner,
      default_branch: repo.default_branch,
      private: repo.private,
    })
  } catch (error) {
    console.error("[github/create-repo] Error:", error)
    return githubErrorResponse(error, "Failed to create repository", {
      422: "Repository name already exists or is invalid",
    })
  }
}
