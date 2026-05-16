import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"
import { uninstallSkill, getSkillNameFromHandle } from "@upstream/skills/sandbox"

// =============================================================================
// DELETE - Uninstall a skill by ID (DB + sandbox filesystem)
// =============================================================================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { id } = await params

  try {
    // Fetch the full skill record (need fullHandle for filesystem removal)
    const skill = await prisma.skill.findUnique({
      where: { id },
    })

    if (!skill || skill.userId !== userId) {
      return notFound("Skill not found")
    }

    // Delete from DB first
    await prisma.skill.delete({ where: { id } })

    // Best-effort: remove from sandbox filesystem if chatId is provided
    const chatId = new URL(req.url).searchParams.get("chatId")
    if (chatId) {
      const daytonaApiKey = process.env.DAYTONA_API_KEY
      if (daytonaApiKey) {
        try {
          const chat = await prisma.chat.findUnique({
            where: { id: chatId },
            select: { sandboxId: true, userId: true },
          })

          if (chat?.sandboxId && chat.userId === userId) {
            const daytona = new Daytona({ apiKey: daytonaApiKey })
            const sandbox = await daytona.get(chat.sandboxId)
            const repoPath = `${PATHS.SANDBOX_HOME}/project`

            const skillName = getSkillNameFromHandle(skill.fullHandle)
            await uninstallSkill(sandbox, repoPath, skillName)
          }
        } catch (err) {
          // Best-effort — log but don't fail the request
          console.error("[skills/delete] Failed to remove from sandbox:", err)
        }
      }
    }

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
