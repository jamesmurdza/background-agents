import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { createRepo, type GitHubRepo } from "@upstream/common"

export async function POST(req: Request) {
  // 1. Get session and verify auth
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json(
      { error: "Unauthorized - please sign in with GitHub" },
      { status: 401 }
    )
  }

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
    const repo: GitHubRepo = await createRepo(session.accessToken, {
      name,
      description: description || undefined,
      isPrivate: isPrivate ?? false,
    })

    // 4. Return the created repository details
    return Response.json({
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner,
      default_branch: repo.default_branch,
      private: repo.private,
    })
  } catch (error) {
    console.error("[github/create-repo] Error:", error)

    // Handle specific GitHub errors
    if (error && typeof error === "object" && "status" in error) {
      const ghError = error as { message: string; status: number }
      if (ghError.status === 422) {
        return Response.json(
          { error: "Repository name already exists or is invalid" },
          { status: 422 }
        )
      }
      return Response.json(
        { error: ghError.message || "Failed to create repository" },
        { status: ghError.status }
      )
    }

    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
