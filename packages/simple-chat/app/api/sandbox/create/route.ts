import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import { createSandboxForChat } from "@/lib/sandbox"

export const maxDuration = 300

/**
 * POST /api/sandbox/create
 *
 * Thin wrapper around the createSandboxForChat helper. Kept so callers
 * outside the chat-orchestrator path (and any browser session that hadn't
 * yet picked up new client code) keep working. The chat-orchestrator
 * endpoint /api/chats/[chatId]/messages calls the helper directly and
 * does not go through this route.
 */
export async function POST(req: Request) {
  const body = await req.json()
  const { repo, baseBranch, newBranch, chatId } = body

  if (!repo) {
    return Response.json({ error: "Missing required field: repo" }, { status: 400 })
  }
  if (!newBranch) {
    return Response.json({ error: "Missing required field: newBranch" }, { status: 400 })
  }

  const isNewRepo = repo === NEW_REPOSITORY || repo === "__new__"

  // GitHub repos need a token for cloning. Accept either an explicit
  // body.githubToken (for direct API callers) or fall back to the
  // signed-in session.
  let githubToken: string | undefined = body.githubToken
  if (!isNewRepo && !githubToken) {
    const session = await getServerSession(authOptions)
    if (!session?.accessToken) {
      return Response.json(
        { error: "Unauthorized - provide githubToken in body or sign in" },
        { status: 401 }
      )
    }
    githubToken = session.accessToken
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const created = await createSandboxForChat({
      daytona,
      repo,
      baseBranch: baseBranch ?? "main",
      newBranch,
      githubToken,
    })

    if (chatId) {
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: {
            sandboxId: created.sandboxId,
            branch: created.branch,
            previewUrlPattern: created.previewUrlPattern,
            status: "ready",
          },
        })
      } catch (error) {
        console.error("[sandbox/create] Failed to update chat:", error)
      }
    }

    return Response.json({
      sandboxId: created.sandboxId,
      repoName: created.repoName,
      branch: created.branch,
      previewUrlPattern: created.previewUrlPattern,
    })
  } catch (error) {
    console.error("[sandbox/create] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
