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
import { addMinutes, addYears } from "date-fns"
import { toScheduledJobResponse, UUID_RE } from "@/lib/scheduled-jobs/types"
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
  /** Swap a job (or still-open draft) between trigger types. */
  triggerType?: "interval" | "incoming"
  /** Client-minted token persisted on a draft's final submit (incl. pre-save rotate). */
  incomingToken?: string
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
      triggerType?: string
      intervalMinutes?: number
      autoPR?: boolean
      continueFromLastRun?: boolean
      enabled?: boolean
      nextRunAt?: Date
      consecutiveFailures?: number
      isDraft?: boolean
      incomingToken?: string
    } = {}

    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.prompt !== undefined) updateData.prompt = body.prompt.trim()
    if (body.repo !== undefined) updateData.repo = body.repo.trim()
    if (body.baseBranch !== undefined) updateData.baseBranch = body.baseBranch.trim()
    if (body.agent !== undefined) updateData.agent = body.agent.trim()
    if (body.model !== undefined) updateData.model = body.model?.trim() ?? null
    if (body.triggerType !== undefined && body.triggerType !== job.triggerType) {
      updateData.triggerType = body.triggerType
      if (body.triggerType === "incoming") {
        // Park the run-sweeper far in the future so the cron stops picking
        // this job up; the receiver fires runs instead.
        updateData.nextRunAt = addYears(new Date(), 100)
        // Pre-mint a token for legacy jobs that were created before tokens
        // were always-minted. New jobs already have one, so this is a no-op
        // for them. We don't rotate existing tokens here — that's what the
        // dedicated rotate-token endpoint is for.
        if (!job.incomingToken) {
          updateData.incomingToken = randomUUID()
        }
      } else if (body.triggerType === "interval") {
        // Switching back to interval needs intervalMinutes — fall back to
        // whatever the row had before incoming (could be 0 if the job has
        // never been interval) so the caller can override via the same
        // PATCH if needed.
        const minutes = body.intervalMinutes ?? job.intervalMinutes
        updateData.nextRunAt = addMinutes(new Date(), Math.max(minutes, 1))
      }
    }
    // Honor a client-supplied token (the form mints one before save and can
    // rotate it client-side while still in create mode; the final submit sends
    // the current value). Only well-formed UUIDs are accepted, and this wins
    // over the legacy pre-mint in the triggerType branch above.
    if (typeof body.incomingToken === "string" && UUID_RE.test(body.incomingToken)) {
      updateData.incomingToken = body.incomingToken
    }
    if (body.intervalMinutes !== undefined) {
      updateData.intervalMinutes = body.intervalMinutes
      // Reschedule next run based on new interval. If this PATCH is also
      // switching to incoming above, that nextRunAt assignment wins because
      // it runs after this branch is gated by `body.intervalMinutes !==
      // undefined`. We re-assert the interval-friendly nextRunAt only when
      // the effective triggerType (post-PATCH) is "interval".
      const effectiveType = body.triggerType ?? job.triggerType
      if (effectiveType === "interval") {
        updateData.nextRunAt = addMinutes(new Date(), body.intervalMinutes)
      }
    }
     if (body.autoPR !== undefined) updateData.autoPR = body.autoPR
     if (body.continueFromLastRun !== undefined) updateData.continueFromLastRun = body.continueFromLastRun
     if (body.isDraft !== undefined) {
      updateData.isDraft = body.isDraft
      // Reset the schedule when promoting a draft so the first run lands a
      // full interval after the user finishes creating, not at the placeholder
      // nextRunAt the materialize POST originally wrote. Only relevant for
      // interval-triggered jobs — incoming jobs already park nextRunAt far
      // in the future via the triggerType branch above.
      const effectiveType = body.triggerType ?? job.triggerType
      if (body.isDraft === false && effectiveType === "interval") {
        updateData.nextRunAt = addMinutes(new Date(), body.intervalMinutes ?? job.intervalMinutes)
      }
    }
     if (body.enabled !== undefined) {
      updateData.enabled = body.enabled
      // Reset failure count when re-enabling. Only reschedule for interval
      // jobs — incoming jobs are fired by the receiver, not by nextRunAt.
      const effectiveType = body.triggerType ?? job.triggerType
      if (body.enabled && !job.enabled) {
        updateData.consecutiveFailures = 0
        if (effectiveType === "interval") {
          updateData.nextRunAt = addMinutes(new Date(), job.intervalMinutes)
        }
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
