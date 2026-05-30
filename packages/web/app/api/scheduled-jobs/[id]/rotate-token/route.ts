import { randomUUID } from "crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { toScheduledJobResponse } from "@/lib/scheduled-jobs/types"

// =============================================================================
// POST - Rotate the incoming-webhook token for a scheduled job
// =============================================================================
//
// Invalidates the existing /wh/<token> URL and issues a new one.
// Only valid on jobs with triggerType "incoming".

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
      select: { userId: true, triggerType: true },
    })

    if (!job || job.userId !== userId) {
      return notFound("Scheduled job not found")
    }

    if (job.triggerType !== "incoming") {
      return badRequest("Token rotation is only available for incoming-webhook jobs")
    }

    const incomingToken = randomUUID()
    const updated = await prisma.scheduledJob.update({
      where: { id },
      data: { incomingToken },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    })

    return Response.json(toScheduledJobResponse(updated))
  } catch (error) {
    return internalError(error)
  }
}
