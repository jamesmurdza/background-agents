import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// POST - Trigger immediate run of a scheduled job
// =============================================================================

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params

    // Get job with auth check
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
      include: {
        runs: {
          where: { status: "running" },
          take: 1,
        },
      },
    })

    if (!job || job.userId !== userId) {
      return notFound("Scheduled job not found")
    }

    // Check if already running
    if (job.runs.length > 0) {
      return badRequest("Job is already running")
    }

    // Create a new run in "pending" status
    // The agent-lifecycle cron will pick it up and start it
    const run = await prisma.scheduledJobRun.create({
      data: {
        jobId: id,
        status: "pending",
      },
    })

    return Response.json({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.getTime(),
    }, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
