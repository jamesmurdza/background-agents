import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/api-helpers"
import { generateCommitMessage } from "@/lib/commit-message"

/**
 * POST /api/commits/suggest-message
 * Generates an AI-powered commit message based on the git diff
 */
export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { sandboxId, diff } = body

  if (!sandboxId) {
    return badRequest("Missing sandbox ID")
  }

  if (!diff || diff.trim().length === 0) {
    return badRequest("No diff provided")
  }

  // Verify sandbox ownership
  const sandbox = await prisma.sandbox.findUnique({
    where: { sandboxId },
  })

  if (!sandbox || sandbox.userId !== userId) {
    return notFound("Sandbox not found")
  }

  const result = await generateCommitMessage({ userId, diff })

  return Response.json({
    suggestedMessage: result.isAiGenerated ? result.message : null,
    reason: result.reason,
  })
}
