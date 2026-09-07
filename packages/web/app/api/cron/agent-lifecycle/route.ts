import { Daytona } from "@daytonaio/sdk"
import { addMinutes, differenceInMinutes } from "date-fns"

import { prisma } from "@/lib/db/prisma"
import { logLlmProviderError } from "@/lib/db/activity-log"
import { UsageLimitError } from "@/lib/db/usage-limit"

import { INTERACTIVE_HARD_TIMEOUT, SCHEDULED_HARD_TIMEOUT } from "./_lib/constants"
import { monitorAgent, stopAgent } from "./_lib/monitor"
import { startJobExecution, finalizeScheduledRun, failScheduledRun } from "./_lib/scheduled"
import { finalizeInteractiveChat, markChatError } from "./_lib/interactive"

// Vercel Pro plan allows up to 5 minutes for cron jobs
export const maxDuration = 300

// =============================================================================
// Main Handler
// =============================================================================
// Orchestrates the four phases of the agent lifecycle each cron tick:
//   1. Dispatch due scheduled jobs (create pending run records)
//   2. Start pending scheduled runs (spin up sandboxes + agents)
//   3. Monitor running interactive chats (complete / error / timeout)
//   4. Monitor running scheduled job runs (complete / error / timeout)
// The heavy lifting for each phase lives in ./_lib.

export async function GET(req: Request) {
  // Verify cron secret (skip auth if not configured, for local development)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "DAYTONA_API_KEY not configured" }, { status: 500 })
  }

  const now = new Date()
  const daytona = new Daytona({ apiKey: daytonaApiKey })

  const results = {
    dispatchedJobs: 0,
    startedPendingRuns: 0,
    monitoredInteractive: 0,
    monitoredScheduled: 0,
    completedInteractive: 0,
    completedScheduled: 0,
    timedOutInteractive: 0,
    timedOutScheduled: 0,
    skippedOverLimit: 0,
    errors: [] as string[],
  }

  try {
    // =========================================
    // 1. Dispatch Due Scheduled Jobs
    // =========================================
    const dueJobs = await prisma.scheduledJob.findMany({
      where: {
        enabled: true,
        isDraft: false,
        nextRunAt: { lte: now },
        runs: { none: { status: "running" } },
      },
      include: {
        runs: {
          where: { status: "running" },
          take: 1,
        },
      },
    })

    for (const job of dueJobs) {
      try {
        // Create run record
        await prisma.scheduledJobRun.create({
          data: { jobId: job.id, status: "pending" },
        })

        // Update next run time
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { nextRunAt: addMinutes(now, job.intervalMinutes) },
        })

        results.dispatchedJobs++
      } catch (err) {
        results.errors.push(`Failed to dispatch job ${job.id}: ${err}`)
      }
    }

    // =========================================
    // 2. Start Pending Scheduled Runs
    // =========================================
    // Drafts shouldn't have pending runs (the run-now endpoint blocks them),
    // but filter here too so a stale row from before this guard can't sneak
    // through the cron.
    const pendingRuns = await prisma.scheduledJobRun.findMany({
      where: { status: "pending", job: { isDraft: false } },
      include: { job: true },
    })

    for (const run of pendingRuns) {
      try {
        await startJobExecution(run.job, run, daytona)
        results.startedPendingRuns++
      } catch (err) {
        // A spent daily balance isn't a job failure: record it on the run so
        // the user can see why it didn't run, but leave the job enabled and
        // its failure streak untouched. The balance resets at UTC midnight and
        // nextRunAt was already advanced at dispatch, so the job resumes on
        // its own.
        if (err instanceof UsageLimitError) {
          await failScheduledRun(run, err.message, daytona, { countFailure: false })
          results.skippedOverLimit++
          continue
        }
        await failScheduledRun(run, `Failed to start: ${err}`, daytona)
        results.errors.push(`Failed to start run ${run.id}: ${err}`)
      }
    }

    // =========================================
    // 3. Monitor Interactive Chats
    // =========================================
    const runningChats = await prisma.chat.findMany({
      where: {
        status: "running",
        sandboxId: { not: null },
        backgroundSessionId: { not: null },
        scheduledJobRun: null, // Only interactive chats (no linked run)
      },
      include: {
        messages: {
          where: { role: "assistant" },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    })

    for (const chat of runningChats) {
      results.monitoredInteractive++

      try {
        // Get run start time from last assistant message (when agent started)
        const runStartedAt = chat.messages[0]?.createdAt ?? chat.lastActiveAt
        const totalMinutes = differenceInMinutes(now, runStartedAt)

        // Hard timeout: 25 minutes
        if (totalMinutes > INTERACTIVE_HARD_TIMEOUT) {
          // stopAgent reads the agent session id before it cancels, which is
          // the only chance to learn it: a 25-minute run is the most expensive
          // kind of failure to leave unbilled.
          const agentSessionId = await stopAgent(
            chat.sandboxId!,
            chat.backgroundSessionId!,
            daytona
          )
          await markChatError(
            chat,
            "Run exceeded 25 minute limit",
            daytona,
            agentSessionId
          )
          results.timedOutInteractive++
          continue
        }

        // Monitor and check completion
        await monitorAgent(chat.sandboxId!, chat.backgroundSessionId!, daytona, {
          onComplete: async (snapshot) => {
            await finalizeInteractiveChat(chat, snapshot, daytona)
            results.completedInteractive++
          },
          onError: async (error, errorKind, snapshot) => {
            logLlmProviderError({
              userId: chat.userId,
              agent: chat.agent,
              model: chat.model,
              chatId: chat.id,
              source: "cron-interactive",
              error,
              errorKind,
            })
            await markChatError(chat, error, daytona, snapshot.sessionId)
          },
        })
      } catch (err) {
        results.errors.push(`Failed to monitor chat ${chat.id}: ${err}`)
      }
    }

    // =========================================
    // 4. Monitor Scheduled Job Runs
    // =========================================
    const runningJobs = await prisma.scheduledJobRun.findMany({
      where: { status: "running" },
      include: { job: true },
    })

    for (const run of runningJobs) {
      results.monitoredScheduled++

      try {
        const runningMinutes = differenceInMinutes(now, run.startedAt)

        // Hard timeout: 20 minutes
        if (runningMinutes > SCHEDULED_HARD_TIMEOUT) {
          let agentSessionId: string | undefined
          if (run.sandboxId && run.backgroundSessionId) {
            agentSessionId = await stopAgent(
              run.sandboxId,
              run.backgroundSessionId,
              daytona
            )
          }
          await failScheduledRun(
            run,
            "Run timed out after 20 minutes",
            daytona,
            {},
            agentSessionId
          )
          results.timedOutScheduled++
          continue
        }

        if (run.sandboxId && run.backgroundSessionId) {
          await monitorAgent(run.sandboxId, run.backgroundSessionId, daytona, {
            onComplete: async (snapshot) => {
              await finalizeScheduledRun(run, snapshot, daytona)
              results.completedScheduled++
            },
            onError: async (error, errorKind, snapshot) => {
              logLlmProviderError({
                userId: run.job.userId,
                agent: run.job.agent,
                model: run.job.model,
                jobRunId: run.id,
                source: "cron-scheduled",
                error,
                errorKind,
              })
              await failScheduledRun(run, error, daytona, {}, snapshot.sessionId)
            },
          })
        }
      } catch (err) {
        results.errors.push(`Failed to monitor run ${run.id}: ${err}`)
      }
    }
  } catch (err) {
    results.errors.push(`Top-level error: ${err}`)
  }

  return Response.json(results)
}
