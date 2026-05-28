import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { format } from "date-fns"
import { createSandboxGit } from "@background-agents/daytona-git"
import { getEnvForModel, type Agent } from "@background-agents/common"

import { prisma } from "@/lib/db/prisma"
import { getUserCredentials } from "@/lib/db/api-helpers"
import { getClaudeCredentials } from "@/lib/claude-credentials"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { createSandboxForChat, deleteSandboxQuietly } from "@/lib/sandbox"
import {
  createBackgroundAgentSession,
  finalizeTurn,
  type AgentSnapshot,
} from "@/lib/agent-session"
import { loadMcpConnections } from "@/lib/mcp/agent-servers"

import { getUserPushOptions } from "./push-options"
import type { ScheduledJobRunWithJob } from "./types"

// =============================================================================
// Job Execution
// =============================================================================

export async function startJobExecution(
  job: Prisma.ScheduledJobGetPayload<object>,
  run: Prisma.ScheduledJobRunGetPayload<object>,
  daytona: Daytona
) {
  const isRepoLess = job.repo === NEW_REPOSITORY

  // 1. Get GitHub token for the user — required for cloned repos, optional
  //    for repo-less jobs (the sandbox never reaches out to GitHub, though
  //    MCP servers may still want a token of their own).
  const account = await prisma.account.findFirst({
    where: { userId: job.userId, provider: "github" },
    select: { access_token: true },
  })

  if (!isRepoLess && !account?.access_token) {
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

  // 4. Determine base branch (may be from last run if continueFromLastRun is
  //    enabled). Only applies to repo-backed jobs — repo-less sandboxes have
  //    no remote, so we carry context forward via the prompt instead (see
  //    step 8 below).
  let effectiveBaseBranch = job.baseBranch

  if (job.continueFromLastRun && !isRepoLess) {
    // Find the last successful run with commits
    const lastSuccessfulRun = await prisma.scheduledJobRun.findFirst({
      where: {
        jobId: job.id,
        status: "completed",
        commitCount: { gt: 0 },
        branch: { not: null },
      },
      orderBy: { completedAt: "desc" },
    })

    if (lastSuccessfulRun?.branch) {
      // Check if we should use this run's branch
      // - If no PR was created, use it (commits exist but weren't PR'd)
      // - If PR exists, check its state via GitHub API
      let shouldContinueFromRun = !lastSuccessfulRun.prNumber

      if (lastSuccessfulRun.prNumber) {
        const [owner, repoName] = job.repo.split("/")
        try {
          const prRes = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/pulls/${lastSuccessfulRun.prNumber}`,
            {
              headers: {
                Authorization: `Bearer ${account!.access_token}`,
                Accept: "application/vnd.github.v3+json",
              },
            }
          )

          if (prRes.ok) {
            const prData = await prRes.json()
            // Continue from this run if PR is open or merged (not closed/rejected)
            shouldContinueFromRun = prData.state === "open" || prData.merged === true
          }
        } catch (err) {
          console.error(`[agent-lifecycle] Failed to check PR state:`, err)
          // On error, fall back to base branch (safer default)
        }
      }

      if (shouldContinueFromRun) {
        effectiveBaseBranch = lastSuccessfulRun.branch
      }
    }
  }

  // 5. Create fresh sandbox. createSandboxForChat detects NEW_REPOSITORY and
  //    skips the clone path, so we don't need the GitHub token in that case.
  const branch = `scheduled/${job.id}/${format(new Date(), "yyyyMMdd-HHmmss")}`
  const { sandbox, sandboxId, previewUrlPattern } = await createSandboxForChat({
    daytona,
    repo: job.repo,
    baseBranch: effectiveBaseBranch,
    newBranch: branch,
    githubToken: account?.access_token ?? undefined,
    userId: job.userId,
  })

  // 6. Update chat with sandbox info
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

  // Load job-scoped MCP servers. The loader marks rows with status="error" and
  // a descriptive lastError if the GitHub App is gone or any other auth issue
  // is found — best-effort, so the run proceeds without that MCP server rather
  // than failing the whole job. Failure to load shouldn't tank the turn.
  let mcpServers: Awaited<ReturnType<typeof loadMcpConnections>> = []
  try {
    mcpServers = await loadMcpConnections({ kind: "job", id: job.id })
  } catch (err) {
    console.error(`[agent-lifecycle] loadMcpConnections failed for ${job.id}:`, err)
  }

  const bgSession = await createBackgroundAgentSession(sandbox, {
    repoPath,
    previewUrlPattern: previewUrlPattern ?? undefined,
    agent: job.agent as Agent,
    model: job.model ?? undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    mcpServers,
  })

  // 8. Build the prompt (augment with trigger context for webhook-triggered runs)
  let finalPrompt = job.prompt

  // Repo-less continueFromLastRun: there's no remote branch to carry forward,
  // so include the previous run's final assistant message as prompt context.
  if (job.continueFromLastRun && isRepoLess) {
    const lastRun = await prisma.scheduledJobRun.findFirst({
      where: {
        jobId: job.id,
        status: "completed",
        chatId: { not: null },
        id: { not: run.id },
      },
      orderBy: { completedAt: "desc" },
      select: { chatId: true },
    })

    if (lastRun?.chatId) {
      const lastAssistantMessage = await prisma.message.findFirst({
        where: { chatId: lastRun.chatId, role: "assistant" },
        orderBy: { timestamp: "desc" },
        select: { content: true },
      })

      if (lastAssistantMessage?.content?.trim()) {
        finalPrompt = [
          `## Context from previous run`,
          ``,
          lastAssistantMessage.content.trim(),
          ``,
          `---`,
          ``,
          job.prompt,
        ].join("\n")
      }
    }
  }

  if (run.triggerContext && job.triggerType === "webhook") {
    const ctx = run.triggerContext as {
      workflowName?: string
      workflowUrl?: string
      branch?: string
      commitSha?: string
      failedAt?: string
    }

    const contextLines = [
      `## CI/CD Failure Context`,
      ``,
      `A GitHub Actions workflow has failed:`,
      ctx.workflowName ? `- **Workflow**: ${ctx.workflowName}` : null,
      ctx.branch ? `- **Branch**: ${ctx.branch}` : null,
      ctx.commitSha ? `- **Commit**: ${ctx.commitSha.slice(0, 7)}` : null,
      ctx.workflowUrl ? `- **Details**: ${ctx.workflowUrl}` : null,
      ctx.failedAt ? `- **Failed at**: ${ctx.failedAt}` : null,
      ``,
      `---`,
      ``,
      job.prompt,
    ].filter(Boolean).join("\n")

    finalPrompt = contextLines
  }

  // 9. Create user message for the prompt
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const timestamp = BigInt(Date.now())

  await prisma.message.createMany({
    data: [
      {
        id: userMessageId,
        chatId: chat.id,
        role: "user",
        content: finalPrompt,
        timestamp,
        agent: job.agent,
        model: job.model,
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

  // 10. Update chat with background session info
  await prisma.chat.update({
    where: { id: chat.id },
    data: { backgroundSessionId: bgSession.backgroundSessionId },
  })

  // 11. Start the agent
  await bgSession.start(finalPrompt)

  // 12. Store session info for monitoring
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: {
      sandboxId,
      backgroundSessionId: bgSession.backgroundSessionId,
      branch,
      baseBranch: effectiveBaseBranch,
    },
  })
}

// =============================================================================
// Run Finalization
// =============================================================================

export async function finalizeScheduledRun(
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
  const isRepoLess = job.repo === NEW_REPOSITORY

  if (run.sandboxId && run.branch) {
    try {
      const sandbox = await daytona.get(run.sandboxId)
      const repoPath = `${PATHS.SANDBOX_HOME}/project`

      // Finalize the agent turn
      if (run.backgroundSessionId) {
        await finalizeTurn(sandbox, run.backgroundSessionId, { repoPath })
      }

      // Repo-less sandboxes have no remote to compare against and nothing to
      // push/PR — just finalize the turn and bail out of the git workflow.
      if (isRepoLess) {
        // fall through to run-record update below
      } else {

      // Count commits on branch vs the base branch this run was created from
      const baseForComparison = run.baseBranch || job.baseBranch
      const countResult = await sandbox.process.executeCommand(
        `cd ${repoPath} && git rev-list --count origin/${baseForComparison}..HEAD 2>/dev/null || echo 0`
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
          const pushOptions = await getUserPushOptions(job.userId)
          await git.push(repoPath, account.access_token, pushOptions)

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
          const pushOptions = await getUserPushOptions(job.userId)
          await git.push(repoPath, account.access_token, pushOptions)
        }
      }
      } // end !isRepoLess
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

  // 6. Delete sandbox now that run is complete
  if (run.sandboxId) {
    await deleteSandboxQuietly(daytona, run.sandboxId)
  }
}

export async function failScheduledRun(
  run: ScheduledJobRunWithJob | Prisma.ScheduledJobRunGetPayload<{ include: { job: true } }>,
  error: string,
  daytona?: Daytona
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

  // Delete sandbox now that run is complete
  if (run.sandboxId && daytona) {
    await deleteSandboxQuietly(daytona, run.sandboxId)
  }
}
