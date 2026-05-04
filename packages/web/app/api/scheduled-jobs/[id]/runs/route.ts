import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobRunResponse {
  id: string
  status: string
  startedAt: number
  completedAt: number | null
  branch: string | null
  commitCount: number
  prUrl: string | null
  prNumber: number | null
  error: string | null
  chatId: string | null
}

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

    const response: ScheduledJobRunResponse[] = runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.getTime(),
      completedAt: run.completedAt?.getTime() ?? null,
      branch: run.branch,
      commitCount: run.commitCount,
      prUrl: run.prUrl,
      prNumber: run.prNumber,
      error: run.error,
      chatId: run.chatId,
    }))

    return Response.json({ runs: response })
  } catch (error) {
    return internalError(error)
  }
}
