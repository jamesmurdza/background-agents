import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes } from "date-fns"

// =============================================================================
// Constants
// =============================================================================

const MAX_JOBS_PER_USER = 5

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobResponse {
  id: string
  name: string
  prompt: string
  repo: string
  baseBranch: string
  agent: string
  model: string | null
  intervalMinutes: number
  enabled: boolean
  nextRunAt: number
  autoPR: boolean
  consecutiveFailures: number
  createdAt: number
  updatedAt: number
  lastRun: {
    id: string
    status: string
    startedAt: number
    completedAt: number | null
    prUrl: string | null
    prNumber: number | null
    error: string | null
  } | null
}

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

    const response: ScheduledJobResponse[] = jobs.map((job) => {
      const lastRun = job.runs[0]
      return {
        id: job.id,
        name: job.name,
        prompt: job.prompt,
        repo: job.repo,
        baseBranch: job.baseBranch,
        agent: job.agent,
        model: job.model,
        intervalMinutes: job.intervalMinutes,
        enabled: job.enabled,
        nextRunAt: job.nextRunAt.getTime(),
        autoPR: job.autoPR,
        consecutiveFailures: job.consecutiveFailures,
        createdAt: job.createdAt.getTime(),
        updatedAt: job.updatedAt.getTime(),
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt.getTime(),
              completedAt: lastRun.completedAt?.getTime() ?? null,
              prUrl: lastRun.prUrl,
              prNumber: lastRun.prNumber,
              error: lastRun.error,
            }
          : null,
      }
    })

    return Response.json({ jobs: response })
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

    const response: ScheduledJobResponse = {
      id: job.id,
      name: job.name,
      prompt: job.prompt,
      repo: job.repo,
      baseBranch: job.baseBranch,
      agent: job.agent,
      model: job.model,
      intervalMinutes: job.intervalMinutes,
      enabled: job.enabled,
      nextRunAt: job.nextRunAt.getTime(),
      autoPR: job.autoPR,
      consecutiveFailures: job.consecutiveFailures,
      createdAt: job.createdAt.getTime(),
      updatedAt: job.updatedAt.getTime(),
      lastRun: null,
    }

    return Response.json(response, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
