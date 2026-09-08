import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, badRequest, notFound, internalError } from "@/lib/db/api-helpers"
import { getOwnedEnvironment, toEnvironmentDTO } from "@/lib/environments"

/**
 * Swap setupScriptPrevious back into setupScript.
 *
 * One level of undo, which is what makes it acceptable for an agent to rewrite
 * config shared by every chat on the repo as a side effect of a coding turn.
 * The revert is itself recorded as a user edit, so reverting twice is not a
 * redo loop.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const existing = await getOwnedEnvironment(userId, id)
    if (!existing) return notFound("Environment not found")
    if (existing.setupScriptPrevious === null) {
      return badRequest("There is no previous version to revert to")
    }

    const updated = await prisma.environment.update({
      where: { id },
      data: {
        setupScript: existing.setupScriptPrevious,
        setupScriptPrevious: existing.setupScript,
        setupScriptUpdatedBy: "user",
      },
    })

    return Response.json({ environment: toEnvironmentDTO(updated) })
  } catch (error) {
    return internalError(error)
  }
}
