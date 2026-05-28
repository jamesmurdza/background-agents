import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  requireGitHubAuth,
  isAuthError,
  isGitHubAuthError,
  badRequest,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes } from "date-fns"
import { toScheduledJobResponse } from "@/lib/scheduled-jobs/types"
import { deleteWebhook } from "@background-agents/common"
import { cleanupSmitheryConnections } from "@/lib/mcp/connections"

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
  continueFromLastRun?: boolean
  enabled?: boolean
  /** Flip from true → false when the user clicks Create on a materialized draft. */
  isDraft?: boolean
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
      continueFromLastRun?: boolean
      enabled?: boolean
      nextRunAt?: Date
      consecutiveFailures?: number
      isDraft?: boolean
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
     if (body.continueFromLastRun !== undefined) updateData.continueFromLastRun = body.continueFromLastRun
     if (body.isDraft !== undefined) {
      updateData.isDraft = body.isDraft
      // Reset the schedule when promoting a draft so the first run lands a
      // full interval after the user finishes creating, not at the placeholder
      // nextRunAt the materialize POST originally wrote.
      if (body.isDraft === false) {
        updateData.nextRunAt = addMinutes(new Date(), body.intervalMinutes ?? job.intervalMinutes)
      }
    }
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
      select: {
        userId: true,
        triggerType: true,
        githubWebhookId: true,
        repo: true,
      },
    })

    if (!job || job.userId !== userId) {
      return notFound("Scheduled job not found")
    }

    // Delete webhook from GitHub if this was a webhook-triggered job
    if (job.triggerType === "webhook" && job.githubWebhookId) {
      const ghAuth = await requireGitHubAuth()
      if (!isGitHubAuthError(ghAuth)) {
        const [owner, repoName] = job.repo.split("/")
        if (owner && repoName) {
          try {
            await deleteWebhook(ghAuth.token, owner, repoName, job.githubWebhookId)
          } catch (err) {
            // Log but don't fail deletion if webhook cleanup fails
            console.error("[scheduled-jobs] Failed to delete webhook:", err)
          }
        }
      }
    }

    // Best-effort Smithery cleanup before we drop the DB rows. The MCP rows
    // themselves cascade with the job; Smithery's side has to be told
    // explicitly or the connection lingers and counts against quota.
    await cleanupSmitheryConnections({ kind: "job", id })

    // Delete job (cascades to runs and mcpServers, but runs' chats need
    // manual cleanup).
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

    // Then delete the job (cascades to runs and ScheduledJobMcpServer)
    await prisma.scheduledJob.delete({
      where: { id },
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    return internalError(error)
  }
}
