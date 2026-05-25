import { randomBytes } from "crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  requireGitHubAuth,
  isAuthError,
  isGitHubAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { addMinutes, addYears } from "date-fns"
import { toScheduledJobResponse } from "@/lib/scheduled-jobs/types"
import { createWebhook } from "@upstream/common"
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
  triggerType?: "interval" | "webhook"
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

    // Webhook triggers need a real GitHub repo to attach to.
    if (triggerType === "webhook" && isRepoLess) {
      return badRequest("Webhook triggers require a repository")
    }

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

    // Handle webhook trigger type
    if (triggerType === "webhook") {
      // Need GitHub auth to create webhook
      const ghAuth = await requireGitHubAuth()
      if (isGitHubAuthError(ghAuth)) return ghAuth

      const [owner, repoName] = body.repo.split("/")
      if (!owner || !repoName) {
        return badRequest("Invalid repo format")
      }

      // Generate webhook secret
      const webhookSecret = randomBytes(32).toString("hex")

      // Determine webhook URL
      const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
      if (!baseUrl) {
        return badRequest("Server configuration error: missing base URL")
      }
      const webhookUrl = `${baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`}/api/webhooks/github`

      // Create webhook on GitHub
      let githubWebhookId: number
      try {
        const webhook = await createWebhook(ghAuth.token, owner, repoName, {
          url: webhookUrl,
          secret: webhookSecret,
          events: ["workflow_run"],
        })
        githubWebhookId = webhook.id
      } catch (error) {
        console.error("[scheduled-jobs] Failed to create webhook:", error)
        return badRequest("Failed to create GitHub webhook. Make sure you have admin access to the repository.")
      }

      // Create webhook-triggered job
      const job = await prisma.scheduledJob.create({
        data: {
          userId,
          name: body.name.trim(),
          prompt: body.prompt.trim(),
          repo: body.repo.trim(),
          baseBranch: body.baseBranch.trim(),
          agent: body.agent.trim(),
          model: body.model?.trim() ?? null,
          triggerType: "webhook",
          githubWebhookId,
          webhookSecret,
          intervalMinutes: 0, // Not used for webhooks
          autoPR: body.autoPR ?? true,
          continueFromLastRun: body.continueFromLastRun ?? false,
          nextRunAt: addYears(now, 100), // Far future - webhook jobs don't use nextRunAt
        },
      })

      return Response.json(toScheduledJobResponse(job), { status: 201 })
    }

    // Create interval-triggered job (existing behavior)
    const job = await prisma.scheduledJob.create({
      data: {
        userId,
        name: body.name.trim(),
        prompt: body.prompt.trim(),
        repo: body.repo.trim(),
        baseBranch: body.baseBranch.trim(),
        agent: body.agent.trim(),
        model: body.model?.trim() ?? null,
        triggerType: "interval",
        intervalMinutes: body.intervalMinutes!,
        autoPR: body.autoPR ?? true,
        continueFromLastRun: body.continueFromLastRun ?? false,
        nextRunAt: addMinutes(now, body.intervalMinutes!),
        isDraft: body.isDraft ?? false,
        enabled: body.enabled ?? true,
      },
    })

    return Response.json(toScheduledJobResponse(job), { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
