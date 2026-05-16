import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"
import { installSkills } from "@upstream/skills/sandbox"

// =============================================================================
// POST - Install skills into a chat's sandbox
// =============================================================================

interface InstallBody {
  chatId: string
  skillIds?: string[] // If omitted, install ALL skills for the chat's repo
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const body: InstallBody = await req.json()

    if (!body.chatId) {
      return badRequest("chatId is required")
    }

    // Verify chat ownership and get sandbox info
    const chat = await prisma.chat.findUnique({
      where: { id: body.chatId },
      select: { userId: true, sandboxId: true, repo: true },
    })

    if (!chat || chat.userId !== userId) {
      return notFound("Chat not found")
    }

    if (!chat.sandboxId) {
      return badRequest("Chat has no sandbox — send a message first")
    }

    // Fetch skills to install
    const whereClause: { userId: string; repo: string; id?: { in: string[] } } = {
      userId,
      repo: chat.repo,
    }
    if (body.skillIds && body.skillIds.length > 0) {
      whereClause.id = { in: body.skillIds }
    }

    const skills = await prisma.skill.findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
    })

    if (skills.length === 0) {
      return Response.json({ installed: 0, total: 0, results: [] })
    }

    // Connect to sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(chat.sandboxId)

    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // Install skills using the package function
    const result = await installSkills(
      sandbox,
      repoPath,
      skills.map((s) => ({ id: s.id, fullHandle: s.fullHandle })),
      async (id) => {
        // Clean up invalid DB records
        await prisma.skill.delete({ where: { id } }).catch(() => {})
      }
    )

    return Response.json(result)
  } catch (error) {
    return internalError(error)
  }
}
