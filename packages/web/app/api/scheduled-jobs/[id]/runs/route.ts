import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { toScheduledJobRunResponse } from "@/lib/scheduled-jobs/types"

// =============================================================================
// GET - List runs for a scheduled job
// =============================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params

    // Verify job ownership
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!job || job.userId !== userId) {
      return notFound("Scheduled job not found")
    }

    // Get pagination params
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)
    const offset = parseInt(searchParams.get("offset") ?? "0")

    const runs = await prisma.scheduledJobRun.findMany({
      where: { jobId: id },
      orderBy: { startedAt: "desc" },
      take: limit,
      skip: offset,
    })

    return Response.json({ runs: runs.map(toScheduledJobRunResponse) })
  } catch (error) {
    return internalError(error)
  }
}
