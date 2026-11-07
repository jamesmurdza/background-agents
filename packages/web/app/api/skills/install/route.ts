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
  getGitHubToken,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { recreateChatSandbox } from "@/lib/sandbox"
import { installSkills, installPredefinedSkill } from "@background-agents/sandbox-skills/sandbox"

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
      select: { id: true, userId: true, sandboxId: true, repo: true, baseBranch: true, branch: true },
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

    // Connect to sandbox — recreate transparently if it expired, same path
    // used elsewhere (sandbox/git, github/squash): reinstalling skills into a
    // freshly recreated sandbox is safe, there's no local-only state at risk.
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox = await getSandboxOrExpired(daytona, chat.sandboxId)
    if (sandbox instanceof Response) {
      const githubToken = chat.repo === NEW_REPOSITORY ? null : await getGitHubToken(userId)
      const recreated = await recreateChatSandbox({ daytona, chat, userId, githubToken })
      if (!recreated) return sandbox
      sandbox = recreated.sandbox
    }

    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // Predefined skills (fullHandle "predefined/<id>") aren't skills.sh
    // handles — they're built-in skills shipped by this app, installed via
    // a GitHub tree URL back at this repo's own packages/predefined-skills/.
    // Route them to installPredefinedSkill instead of the generic installer.
    const predefinedSkills = skills.filter((s) => s.fullHandle.startsWith("predefined/"))
    const regularSkills = skills.filter((s) => !s.fullHandle.startsWith("predefined/"))

    const predefinedResults = await Promise.all(
      predefinedSkills.map(async (s) => {
        const id = s.fullHandle.slice("predefined/".length)
        const result = await installPredefinedSkill(sandbox, repoPath, id)
        if (!result.success) {
          await prisma.skill.delete({ where: { id: s.id } }).catch(() => {})
        }
        return result
      })
    )

    const regularResult =
      regularSkills.length > 0
        ? await installSkills(
            sandbox,
            repoPath,
            regularSkills.map((s) => ({ id: s.id, fullHandle: s.fullHandle, archive: s.archive })),
            async (id) => {
              // Clean up invalid DB records
              await prisma.skill.delete({ where: { id } }).catch(() => {})
            }
          )
        : { installed: 0, total: 0, results: [] }

    const results = [...predefinedResults, ...regularResult.results]
    return Response.json({
      installed: regularResult.installed + predefinedResults.filter((r) => r.success).length,
      total: skills.length,
      results,
    })
  } catch (error) {
    return internalError(error)
  }
}
