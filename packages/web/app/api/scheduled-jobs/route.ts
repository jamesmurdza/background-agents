import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes } from "date-fns"
import { toScheduledJobResponse } from "@/lib/scheduled-jobs/types"

// =============================================================================
// Constants
// =============================================================================

const MAX_JOBS_PER_USER = 5

// =============================================================================
// GET - List all scheduled jobs for user
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const jobs = await prisma.scheduledJob.findMany({
      where: { userId },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return Response.json({ jobs: jobs.map(toScheduledJobResponse) })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// POST - Create a new scheduled job
// =============================================================================

interface CreateScheduledJobBody {
  name: string
  prompt: string
  repo: string
  baseBranch: string
  agent: string
  model?: string
  intervalMinutes: number
  autoPR?: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateScheduledJobBody = await req.json()

    // Validate required fields
    if (!body.name?.trim()) {
      return badRequest("name is required")
    }
    if (!body.prompt?.trim()) {
      return badRequest("prompt is required")
    }
    if (!body.repo?.trim()) {
      return badRequest("repo is required")
    }
    if (!body.baseBranch?.trim()) {
      return badRequest("baseBranch is required")
    }
    if (!body.agent?.trim()) {
      return badRequest("agent is required")
    }
    if (!body.intervalMinutes || body.intervalMinutes < 1) {
      return badRequest("intervalMinutes must be at least 1")
    }

    // Check job limit
    const existingCount = await prisma.scheduledJob.count({
      where: { userId },
    })
    if (existingCount >= MAX_JOBS_PER_USER) {
      return badRequest(`Maximum ${MAX_JOBS_PER_USER} scheduled jobs allowed`)
    }

    // Create job with first run scheduled
    const now = new Date()
    const job = await prisma.scheduledJob.create({
      data: {
        userId,
        name: body.name.trim(),
        prompt: body.prompt.trim(),
        repo: body.repo.trim(),
        baseBranch: body.baseBranch.trim(),
        agent: body.agent.trim(),
        model: body.model?.trim() ?? null,
        intervalMinutes: body.intervalMinutes,
        autoPR: body.autoPR ?? true,
        nextRunAt: addMinutes(now, body.intervalMinutes),
      },
    })

    return Response.json(toScheduledJobResponse(job), { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
