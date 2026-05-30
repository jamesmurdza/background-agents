import { randomUUID } from "crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes, addYears } from "date-fns"
import { toScheduledJobResponse, UUID_RE } from "@/lib/scheduled-jobs/types"
import { NEW_REPOSITORY } from "@/lib/types"

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
      where: { userId, isDraft: false },
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
  triggerType?: "interval" | "incoming"
  /** Client-minted UUID so the form can show the webhook URL before saving. */
  incomingToken?: string
  intervalMinutes?: number // Required for interval trigger
  autoPR?: boolean
  continueFromLastRun?: boolean
  /** True when materializing via the MCP picker before the form is finished. */
  isDraft?: boolean
  /** Lets the form-side materialize keep the row inert until final submit. */
  enabled?: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateScheduledJobBody = await req.json()
    const triggerType = body.triggerType ?? "interval"

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

    const isRepoLess = body.repo.trim() === NEW_REPOSITORY

    // Validate trigger-specific fields
    if (triggerType === "interval") {
      if (!body.intervalMinutes || body.intervalMinutes < 1) {
        return badRequest("intervalMinutes must be at least 1")
      }
    }

    // Check job limit (drafts don't count — they're transient until the user
    // finishes the create flow).
    const existingCount = await prisma.scheduledJob.count({
      where: { userId, isDraft: false },
    })
    if (existingCount >= MAX_JOBS_PER_USER) {
      return badRequest(`Maximum ${MAX_JOBS_PER_USER} scheduled jobs allowed`)
    }

    const now = new Date()

    // Every job gets an incomingToken on create, regardless of triggerType.
    // The token is dormant on interval jobs (the receiver rejects unless
    // triggerType is "incoming"), but minting it up-front lets a user swap
    // a job from interval → incoming later — including mid-draft — without
    // a second round-trip to issue a URL.
    //
    // Honor a client-supplied token when it's a well-formed UUID: the form
    // mints one so it can show the webhook URL before the job is saved, and we
    // persist that same value so the pre-save URL keeps working. Anything
    // malformed falls back to a server-minted UUID.
    const incomingToken =
      typeof body.incomingToken === "string" && UUID_RE.test(body.incomingToken)
        ? body.incomingToken
        : randomUUID()

    const job = await prisma.scheduledJob.create({
      data: {
        userId,
        name: body.name.trim(),
        prompt: body.prompt.trim(),
        repo: body.repo.trim(),
        baseBranch: body.baseBranch.trim(),
        agent: body.agent.trim(),
        model: body.model?.trim() ?? null,
        triggerType,
        incomingToken,
        // Interval jobs need intervalMinutes; incoming jobs don't use it but
        // the column is NOT NULL so we write 0.
        intervalMinutes: triggerType === "interval" ? body.intervalMinutes! : 0,
        // Repo-less jobs have nothing to push to.
        autoPR: isRepoLess ? false : body.autoPR ?? true,
        continueFromLastRun: body.continueFromLastRun ?? false,
        // Interval jobs schedule a real next run; incoming jobs sit far in
        // the future so the nextRunAt sweeper never picks them up.
        nextRunAt:
          triggerType === "interval"
            ? addMinutes(now, body.intervalMinutes!)
            : addYears(now, 100),
        isDraft: body.isDraft ?? false,
        enabled: body.enabled ?? true,
      },
    })

    return Response.json(toScheduledJobResponse(job), { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
