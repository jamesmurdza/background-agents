import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { addMinutes, differenceInMinutes, format } from "date-fns"
import { createSandboxGit } from "@upstream/daytona-git"
import { getEnvForModel, type Agent } from "@upstream/common"

import { prisma } from "@/lib/db/prisma"
import { getUserCredentials } from "@/lib/db/api-helpers"
import { getClaudeCredentials } from "@/lib/claude-credentials"
import { PATHS } from "@/lib/constants"
import { createSandboxForChat } from "@/lib/sandbox"
import {
  createBackgroundAgentSession,
  snapshotBackgroundAgent,
  finalizeTurn,
  cancelBackgroundAgent,
  type AgentSnapshot,
} from "@/lib/agent-session"
import { createGitOperationMessage } from "@/lib/db/git-messages"

// Vercel Pro plan allows up to 5 minutes for cron jobs
export const maxDuration = 300

// =============================================================================
// Timeouts
// =============================================================================

const INTERACTIVE_INACTIVITY_TIMEOUT = 10 // minutes
const INTERACTIVE_HARD_TIMEOUT = 25 // minutes
const SCHEDULED_HARD_TIMEOUT = 20 // minutes

// =============================================================================
// Types
// =============================================================================

type ScheduledJobWithRuns = Prisma.ScheduledJobGetPayload<{
  include: { runs: { where: { status: "running" }; take: 1 } }
}>

type ScheduledJobRunWithJob = Prisma.ScheduledJobRunGetPayload<{
  include: { job: true }
}>

type ChatWithMessages = Prisma.ChatGetPayload<{
  include: {
    messages: {
      where: { role: "assistant" }
      orderBy: { timestamp: "desc" }
      take: 1
    }
  }
}>

// =============================================================================
// Main Handler
// =============================================================================

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
    errors: [] as string[],
  }

  try {
    // =========================================
    // 1. Dispatch Due Scheduled Jobs
    // =========================================
    const dueJobs = await prisma.scheduledJob.findMany({
      where: {
        enabled: true,
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
    const pendingRuns = await prisma.scheduledJobRun.findMany({
      where: { status: "pending" },
      include: { job: true },
    })

    for (const run of pendingRuns) {
      try {
        await startJobExecution(run.job, run, daytona)
        results.startedPendingRuns++
      } catch (err) {
        await failScheduledRun(run, `Failed to start: ${err}`)
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
        const minutesSinceActive = differenceInMinutes(now, chat.lastActiveAt)
        // Get run start time from last assistant message (when agent started)
        const runStartedAt = chat.messages[0]?.createdAt ?? chat.lastActiveAt
        const totalMinutes = differenceInMinutes(now, runStartedAt)

        // Hard timeout: 25 minutes
        if (totalMinutes > INTERACTIVE_HARD_TIMEOUT) {
          await stopAgent(chat.sandboxId!, chat.backgroundSessionId!, daytona)
          await markChatError(chat.id, "Run exceeded 25 minute limit")
          results.timedOutInteractive++
          continue
        }

        // Inactivity timeout: 10 minutes since browser activity
        if (minutesSinceActive > INTERACTIVE_INACTIVITY_TIMEOUT) {
          await stopAgent(chat.sandboxId!, chat.backgroundSessionId!, daytona)
          await markChatError(chat.id, "No activity for 10 minutes")
          results.timedOutInteractive++
          continue
        }

        // Monitor and check completion
        await monitorAgent(chat.sandboxId!, chat.backgroundSessionId!, daytona, {
          onComplete: async (snapshot) => {
            await finalizeInteractiveChat(chat, snapshot, daytona)
            results.completedInteractive++
          },
          onError: async (error) => {
            await markChatError(chat.id, error)
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
          if (run.sandboxId && run.backgroundSessionId) {
            await stopAgent(run.sandboxId, run.backgroundSessionId, daytona)
          }
          await failScheduledRun(run, "Run timed out after 20 minutes")
          results.timedOutScheduled++
          continue
        }

        if (run.sandboxId && run.backgroundSessionId) {
          await monitorAgent(run.sandboxId, run.backgroundSessionId, daytona, {
            onComplete: async (snapshot) => {
              await finalizeScheduledRun(run, snapshot, daytona)
              results.completedScheduled++
            },
            onError: async (error) => {
              await failScheduledRun(run, error)
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

// =============================================================================
// Shared Monitor Logic
// =============================================================================

async function monitorAgent(
  sandboxId: string,
  backgroundSessionId: string,
  daytona: Daytona,
  handlers: {
    onComplete: (snapshot: AgentSnapshot) => Promise<void>
    onError: (error: string) => Promise<void>
  }
) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.refreshActivity() // Keep alive

    const snapshot = await snapshotBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
    })

    if (snapshot.status === "completed") {
      await handlers.onComplete(snapshot)
    } else if (snapshot.status === "error") {
      await handlers.onError(snapshot.error ?? "Unknown error")
    }
    // else still running, check again next cycle
  } catch (err) {
    console.error(`[agent-lifecycle] Monitor error:`, err)
  }
}

async function stopAgent(
  sandboxId: string,
  backgroundSessionId: string,
  daytona: Daytona
) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await cancelBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
    })
  } catch (err) {
    console.error(`[agent-lifecycle] Failed to stop agent:`, err)
  }
}

// =============================================================================
// Job Execution
// =============================================================================

async function startJobExecution(
  job: Prisma.ScheduledJobGetPayload<object>,
  run: Prisma.ScheduledJobRunGetPayload<object>,
  daytona: Daytona
) {
  // 1. Get GitHub token for the user
  const account = await prisma.account.findFirst({
    where: { userId: job.userId, provider: "github" },
    select: { access_token: true },
  })

  if (!account?.access_token) {
    throw new Error("GitHub account not linked")
  }

  // 2. Create chat for this run
  const chat = await prisma.chat.create({
    data: {
      userId: job.userId,
      repo: job.repo,
      baseBranch: job.baseBranch,
      agent: job.agent,
      model: job.model,
      status: "running",
    },
  })

  // 3. Link chat to run (hides from sidebar via scheduledJobRun relation)
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: { chatId: chat.id, status: "running" },
  })

  // 4. Create fresh sandbox
  const branch = `scheduled/${job.id}/${format(new Date(), "yyyyMMdd-HHmmss")}`
  const { sandbox, sandboxId, previewUrlPattern } = await createSandboxForChat({
    daytona,
    repo: job.repo,
    baseBranch: job.baseBranch,
    newBranch: branch,
    githubToken: account.access_token,
    userId: job.userId,
  })

  // 5. Update chat with sandbox info
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      sandboxId,
      branch,
      previewUrlPattern,
    },
  })

  // 6. Get user credentials
  let credentials = await getUserCredentials(job.userId)

  // Shared-pool fallback for Claude Code
  if (job.agent === "claude-code" && !credentials.CLAUDE_CODE_CREDENTIALS) {
    try {
      credentials = {
        ...credentials,
        CLAUDE_CODE_CREDENTIALS: await getClaudeCredentials(),
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to get shared Claude creds:`, err)
    }
  }

  // 7. Create background session
  const repoPath = `${PATHS.SANDBOX_HOME}/project`
  const env = getEnvForModel(job.model ?? undefined, job.agent as Agent, credentials)

  const bgSession = await createBackgroundAgentSession(sandbox, {
    repoPath,
    previewUrlPattern: previewUrlPattern ?? undefined,
    agent: job.agent as Agent,
    model: job.model ?? undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
  })

  // 8. Create user message for the prompt
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const timestamp = BigInt(Date.now())

  await prisma.message.createMany({
    data: [
      {
        id: userMessageId,
        chatId: chat.id,
        role: "user",
        content: job.prompt,
        timestamp,
      },
      {
        id: assistantMessageId,
        chatId: chat.id,
        role: "assistant",
        content: "",
        timestamp: timestamp + BigInt(1),
        agent: job.agent,
        model: job.model,
      },
    ],
  })

  // 9. Update chat with background session info
  await prisma.chat.update({
    where: { id: chat.id },
    data: { backgroundSessionId: bgSession.backgroundSessionId },
  })

  // 10. Start the agent
  await bgSession.start(job.prompt)

  // 11. Store session info for monitoring
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: {
      sandboxId,
      backgroundSessionId: bgSession.backgroundSessionId,
      branch,
    },
  })
}

// =============================================================================
// Run Finalization
// =============================================================================

async function finalizeScheduledRun(
  run: ScheduledJobRunWithJob,
  snapshot: AgentSnapshot,
  daytona: Daytona
) {
  const job = run.job

  // 1. Save messages to linked chat
  if (run.chatId) {
    // Update the assistant message with final content
    const assistantMessage = await prisma.message.findFirst({
      where: { chatId: run.chatId, role: "assistant" },
      orderBy: { timestamp: "desc" },
    })

    if (assistantMessage) {
      await prisma.message.update({
        where: { id: assistantMessage.id },
        data: {
          content: snapshot.content,
          toolCalls:
            snapshot.toolCalls.length > 0
              ? (snapshot.toolCalls as unknown as Prisma.InputJsonValue)
              : undefined,
          contentBlocks:
            snapshot.contentBlocks.length > 0
              ? (snapshot.contentBlocks as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      })
    }

    // Update chat status
    await prisma.chat.update({
      where: { id: run.chatId },
      data: {
        status: "ready",
        backgroundSessionId: null,
        sessionId: snapshot.sessionId || undefined,
        lastActiveAt: new Date(),
      },
    })
  }

  // 2. Count commits and maybe create PR
  let commitCount = 0
  let prUrl: string | null = null
  let prNumber: number | null = null

  if (run.sandboxId && run.branch) {
    try {
      const sandbox = await daytona.get(run.sandboxId)
      const repoPath = `${PATHS.SANDBOX_HOME}/project`

      // Finalize the agent turn
      if (run.backgroundSessionId) {
        await finalizeTurn(sandbox, run.backgroundSessionId, { repoPath })
      }

      // Count commits on branch vs base
      const countResult = await sandbox.process.executeCommand(
        `cd ${repoPath} && git rev-list --count origin/${job.baseBranch}..HEAD 2>/dev/null || echo 0`
      )
      commitCount = parseInt(countResult.result?.trim() || "0", 10)

      // Push and create PR if there are commits
      if (job.autoPR && commitCount > 0) {
        const account = await prisma.account.findFirst({
          where: { userId: job.userId, provider: "github" },
          select: { access_token: true },
        })

        if (account?.access_token) {
          // Push branch
          const git = createSandboxGit(sandbox)
          await git.push(repoPath, account.access_token)

          // Create PR via GitHub API
          const [owner, repoName] = job.repo.split("/")
          const prTitle = `[Scheduled] ${job.name} - ${format(run.startedAt, "MMM d")}`

          const prRes = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/pulls`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${account.access_token}`,
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                title: prTitle,
                head: run.branch,
                base: job.baseBranch,
                body: `Automated run by scheduled job "${job.name}".\n\nCommits: ${commitCount}`,
              }),
            }
          )

          if (prRes.ok) {
            const prData = await prRes.json()
            prUrl = prData.html_url
            prNumber = prData.number
          } else {
            console.error(
              `[agent-lifecycle] Failed to create PR:`,
              await prRes.text()
            )
          }
        }
      } else if (commitCount > 0) {
        // Still push even if not creating PR
        const account = await prisma.account.findFirst({
          where: { userId: job.userId, provider: "github" },
          select: { access_token: true },
        })

        if (account?.access_token) {
          const git = createSandboxGit(sandbox)
          await git.push(repoPath, account.access_token)
        }
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Error finalizing run ${run.id}:`, err)
    }
  }

  // 3. Update run record
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      commitCount,
      prUrl,
      prNumber,
    },
  })

  // 4. Reset consecutive failures on success
  await prisma.scheduledJob.update({
    where: { id: run.jobId },
    data: { consecutiveFailures: 0 },
  })

  // 5. Prune old runs (keep last 50)
  const oldRuns = await prisma.scheduledJobRun.findMany({
    where: { jobId: run.jobId },
    orderBy: { startedAt: "desc" },
    skip: 50,
    select: { id: true, chatId: true },
  })

  if (oldRuns.length > 0) {
    const chatIds = oldRuns.map((r) => r.chatId).filter(Boolean) as string[]
    if (chatIds.length > 0) {
      await prisma.chat.deleteMany({
        where: { id: { in: chatIds } },
      })
    }
    await prisma.scheduledJobRun.deleteMany({
      where: { id: { in: oldRuns.map((r) => r.id) } },
    })
  }
}

async function failScheduledRun(
  run: ScheduledJobRunWithJob | Prisma.ScheduledJobRunGetPayload<{ include: { job: true } }>,
  error: string
) {
  // Update run status
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: { status: "error", completedAt: new Date(), error },
  })

  // Update linked chat status if exists
  if (run.chatId) {
    await prisma.chat.update({
      where: { id: run.chatId },
      data: {
        status: "error",
        backgroundSessionId: null,
      },
    })
  }

  // Track consecutive failures, auto-disable after 3
  const job = run.job
  const failures = job.consecutiveFailures + 1
  await prisma.scheduledJob.update({
    where: { id: run.jobId },
    data: {
      consecutiveFailures: failures,
      enabled: failures < 3,
    },
  })
}

// =============================================================================
// Interactive Chat Finalization
// =============================================================================

async function finalizeInteractiveChat(
  chat: ChatWithMessages,
  snapshot: AgentSnapshot,
  daytona: Daytona
) {
  // 1. Update message content (same as SSE stream does)
  const assistantMessage = chat.messages[0]

  if (assistantMessage) {
    await prisma.message.update({
      where: { id: assistantMessage.id },
      data: {
        content: snapshot.content,
        toolCalls:
          snapshot.toolCalls.length > 0
            ? (snapshot.toolCalls as unknown as Prisma.InputJsonValue)
            : undefined,
        contentBlocks:
          snapshot.contentBlocks.length > 0
            ? (snapshot.contentBlocks as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    })
  }

  // 2. Finalize the turn
  if (chat.sandboxId && chat.backgroundSessionId) {
    try {
      const sandbox = await daytona.get(chat.sandboxId)
      await finalizeTurn(sandbox, chat.backgroundSessionId, {
        repoPath: `${PATHS.SANDBOX_HOME}/project`,
      })

      // 3. Auto-push if chat has a branch (reuse existing logic from SSE stream)
      if (chat.branch && chat.repo && chat.repo !== "__new__") {
        const account = await prisma.account.findFirst({
          where: { userId: chat.userId, provider: "github" },
          select: { access_token: true },
        })

        if (account?.access_token) {
          const git = createSandboxGit(sandbox)
          try {
            await git.push(`${PATHS.SANDBOX_HOME}/project`, account.access_token)
          } catch (err) {
            // Create error message with force-push action (same as SSE stream)
            await createGitOperationMessage(
              chat.id,
              `Push failed: ${err instanceof Error ? err.message : "Unknown error"}`,
              true,
              { action: "force-push" }
            )
          }
        }
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to finalize chat ${chat.id}:`, err)
    }
  }

  // 4. Update chat status
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "ready",
      backgroundSessionId: null,
      sessionId: snapshot.sessionId || undefined,
      lastActiveAt: new Date(),
    },
  })
}

async function markChatError(chatId: string, reason: string) {
  // Update chat status
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      status: "error",
      backgroundSessionId: null,
    },
  })

  // Create error message
  await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
  })
}
