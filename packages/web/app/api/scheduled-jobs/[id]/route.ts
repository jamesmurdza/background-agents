import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes } from "date-fns"
import { toScheduledJobResponse } from "@/lib/scheduled-jobs/types"

// =============================================================================
// Helper: Get job with auth check
// =============================================================================

async function getJobWithAuth(jobId: string, userId: string) {
  const job = await prisma.scheduledJob.findUnique({
    where: { id: jobId },
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  })

  if (!job || job.userId !== userId) {
    return null
  }

  return job
}

// =============================================================================
// GET - Get a single scheduled job
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const job = await getJobWithAuth(id, userId)

    if (!job) {
      return notFound("Scheduled job not found")
    }

    return Response.json(toScheduledJobResponse(job))
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update a scheduled job
// =============================================================================

interface UpdateScheduledJobBody {
  name?: string
  prompt?: string
  repo?: string
  baseBranch?: string
  agent?: string
  model?: string | null
  intervalMinutes?: number
  autoPR?: boolean
  enabled?: boolean
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const job = await getJobWithAuth(id, userId)

    if (!job) {
      return notFound("Scheduled job not found")
    }

    const body: UpdateScheduledJobBody = await req.json()

    // Validate fields if provided
    if (body.name !== undefined && !body.name?.trim()) {
      return badRequest("name cannot be empty")
    }
    if (body.prompt !== undefined && !body.prompt?.trim()) {
      return badRequest("prompt cannot be empty")
    }
    if (body.intervalMinutes !== undefined && body.intervalMinutes < 1) {
      return badRequest("intervalMinutes must be at least 1")
    }

    // Build update data
    const updateData: {
      name?: string
      prompt?: string
      repo?: string
      baseBranch?: string
      agent?: string
      model?: string | null
      intervalMinutes?: number
      autoPR?: boolean
      enabled?: boolean
      nextRunAt?: Date
      consecutiveFailures?: number
    } = {}

    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.prompt !== undefined) updateData.prompt = body.prompt.trim()
    if (body.repo !== undefined) updateData.repo = body.repo.trim()
    if (body.baseBranch !== undefined) updateData.baseBranch = body.baseBranch.trim()
    if (body.agent !== undefined) updateData.agent = body.agent.trim()
    if (body.model !== undefined) updateData.model = body.model?.trim() ?? null
    if (body.intervalMinutes !== undefined) {
      updateData.intervalMinutes = body.intervalMinutes
      // Reschedule next run based on new interval
      updateData.nextRunAt = addMinutes(new Date(), body.intervalMinutes)
    }
    if (body.autoPR !== undefined) updateData.autoPR = body.autoPR
    if (body.enabled !== undefined) {
      updateData.enabled = body.enabled
      // Reset failure count when re-enabling
      if (body.enabled && !job.enabled) {
        updateData.consecutiveFailures = 0
        updateData.nextRunAt = addMinutes(new Date(), job.intervalMinutes)
      }
    }

    const updatedJob = await prisma.scheduledJob.update({
      where: { id },
      data: updateData,
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    })

    return Response.json(toScheduledJobResponse(updatedJob))
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// DELETE - Delete a scheduled job
// =============================================================================

export async function DELETE(
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
      select: { userId: true },
    })

    if (!job || job.userId !== userId) {
      return notFound("Scheduled job not found")
    }

    // Delete job (cascades to runs, but runs' chats need manual cleanup)
    // First, delete linked chats
    const runs = await prisma.scheduledJobRun.findMany({
      where: { jobId: id },
      select: { chatId: true },
    })
    const chatIds = runs.map((r) => r.chatId).filter(Boolean) as string[]

    if (chatIds.length > 0) {
      await prisma.chat.deleteMany({
        where: { id: { in: chatIds } },
      })
    }

    // Then delete the job (cascades to runs)
    await prisma.scheduledJob.delete({
      where: { id },
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    return internalError(error)
  }
}
