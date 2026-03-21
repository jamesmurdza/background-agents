import { prisma } from "@/lib/prisma"
import { ensureSandboxStarted, ensureSandboxReady } from "@/lib/sandbox-resume"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { generateCommitMessage } from "@/lib/commit-message"
import type { Sandbox } from "@daytonaio/sdk"
import {
  requireCompletionAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
  decryptUserCredentials,
  updateSandboxAndBranchStatus,
  getGitHubTokenForUser,
} from "@/lib/api-helpers"
import { PATHS, EXECUTION_STATUS, BRANCH_STATUS } from "@/lib/constants"
import { isLoopFinished, LOOP_CONTINUATION_MESSAGE } from "@/lib/types"
import type { Agent } from "@/lib/types"

// Completion handler timeout - allow up to 60 seconds
export const maxDuration = 60

/**
 * Get the lock file path for a specific execution
 */
function getLockPath(executionId: string): string {
  return `${PATHS.AGENT_COMPLETION_LOCK_PREFIX}${executionId}.lock`
}

/**
 * Attempt to acquire a lock for completion processing.
 * Returns true if lock was acquired, false if already locked.
 */
async function acquireLock(
  sandbox: Sandbox,
  executionId: string,
  source: "client" | "cron"
): Promise<{ acquired: boolean }> {
  const lockPath = getLockPath(executionId)

  // Check if lock already exists for this execution
  const checkResult = await sandbox.process.executeCommand(
    `test -f ${lockPath} && echo "LOCKED" || echo "FREE"`
  )

  if (checkResult.result.trim() === "LOCKED") {
    return { acquired: false }
  }

  // Acquire lock atomically
  const lockContent = JSON.stringify({
    executionId,
    lockedAt: Date.now(),
    source,
  })
  await sandbox.process.executeCommand(
    `echo '${lockContent}' > ${lockPath}`
  )

  return { acquired: true }
}

/**
 * Release the completion lock
 */
async function releaseLock(sandbox: Sandbox, executionId: string): Promise<void> {
  const lockPath = getLockPath(executionId)
  await sandbox.process.executeCommand(`rm -f ${lockPath}`)
}

/**
 * Push with retry logic. Returns { success, nothingToPush } to distinguish
 * between successful push and "already up-to-date" scenarios.
 */
async function pushWithRetry(
  sandbox: Sandbox,
  repoPath: string,
  githubToken: string,
  maxRetries = 2
): Promise<{ success: boolean; nothingToPush?: boolean; error?: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await sandbox.git.push(repoPath, "x-access-token", githubToken)
      return { success: true }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorLower = errorMessage.toLowerCase()

      // Check if this is a "nothing to push" error
      const isNothingToPush =
        errorLower.includes("up-to-date") ||
        errorLower.includes("up to date") ||
        (errorLower.includes("400") && !errorLower.includes("permission") && !errorLower.includes("denied"))

      if (isNothingToPush) {
        return { success: true, nothingToPush: true }
      }

      // If it's a transient error and we have retries left, wait and retry
      const isTransient =
        errorMessage.includes("timeout") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("503") ||
        errorMessage.includes("502")

      if (isTransient && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }

      // Non-transient error or out of retries
      return { success: false, error: errorMessage }
    }
  }
  return { success: false, error: "Max retries exceeded" }
}

/**
 * Run auto-commit and push for a branch
 */
async function runAutoCommitPush(
  sandbox: Sandbox,
  repoPath: string,
  branchName: string,
  userId: string,
  githubToken: string
): Promise<{ committed: boolean; pushed: boolean; commitMessage?: string; error?: string }> {
  // Verify we're on the correct branch
  const status = await sandbox.git.status(repoPath)
  if (status.currentBranch !== branchName) {
    return {
      committed: false,
      pushed: false,
      error: `Branch mismatch: expected ${branchName} but on ${status.currentBranch}`,
    }
  }

  // Check for uncommitted changes
  const statusResult = await sandbox.process.executeCommand(
    `cd ${repoPath} && git status --porcelain 2>&1`
  )

  let committed = false
  let commitMessage = ""

  if (!statusResult.exitCode && statusResult.result.trim()) {
    // Stage all changes
    await sandbox.process.executeCommand(`cd ${repoPath} && git add -A 2>&1`)

    // Get the staged diff for AI commit message
    const diffResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git diff --cached --no-color 2>&1`
    )
    const diff = diffResult.exitCode ? "" : diffResult.result

    // Generate AI commit message
    const commitMessageResult = await generateCommitMessage({
      userId,
      diff,
    })
    commitMessage = commitMessageResult.message

    // Escape the commit message for shell
    const escapedMessage = commitMessage.replace(/'/g, "'\\''")

    const commitResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git commit -m '${escapedMessage}' 2>&1`
    )

    if (commitResult.exitCode) {
      return {
        committed: false,
        pushed: false,
        error: "Commit failed: " + commitResult.result,
      }
    }
    committed = true
  }

  // Double-check we're still on the correct branch before pushing
  const verifyStatus = await sandbox.git.status(repoPath)
  if (verifyStatus.currentBranch !== branchName) {
    return {
      committed,
      pushed: false,
      commitMessage,
      error: `Branch changed during operation: expected ${branchName} but on ${verifyStatus.currentBranch}`,
    }
  }

  // Push with retry
  const pushResult = await pushWithRetry(sandbox, repoPath, githubToken)
  if (!pushResult.success) {
    return {
      committed,
      pushed: false,
      commitMessage,
      error: "Push failed: " + pushResult.error,
    }
  }

  return {
    committed,
    pushed: !pushResult.nothingToPush,
    commitMessage,
  }
}

/**
 * Unified agent completion handler
 *
 * Handles everything that needs to happen when an agent run finishes:
 * - Auto-commit and push
 * - Loop mode continuation check and triggering
 * - Branch status updates (stopping the spinner)
 *
 * Uses a per-execution lockfile to prevent duplicate processing.
 * Can be called by both client (when polling detects completion) and cron job.
 */
export async function POST(req: Request) {
  const auth = await requireCompletionAuth(req)
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { branchId, executionId, status, content, source, stopped } = body as {
    branchId: string
    executionId: string
    status: "completed" | "error"
    content?: string
    source: "client" | "cron"
    stopped?: boolean
  }

  // Validate inputs
  if (!branchId || !executionId || !status || !source) {
    return badRequest("Missing required fields: branchId, executionId, status, source")
  }

  if (status !== "completed" && status !== "error") {
    return badRequest("Invalid status: must be 'completed' or 'error'")
  }

  if (source !== "client" && source !== "cron") {
    return badRequest("Invalid source: must be 'client' or 'cron'")
  }

  console.log(`[agent/completion] Processing completion for execution ${executionId} from ${source}`)

  // Fetch branch with all required relations
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: {
      sandbox: {
        include: {
          user: {
            include: {
              credentials: true,
            },
          },
        },
      },
      repo: true,
    },
  })

  if (!branch) {
    return notFound("Branch not found")
  }

  if (!branch.sandbox) {
    return notFound("Sandbox not found for branch")
  }

  // Verify ownership (skip for cron)
  if (auth.userId !== "SYSTEM_CRON" && branch.sandbox.userId !== auth.userId) {
    return notFound("Branch not found")
  }

  // Get Daytona API key
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  try {
    // Ensure sandbox is running
    const sandbox = await ensureSandboxStarted(daytonaApiKey, branch.sandbox.sandboxId)

    // Try to acquire lock
    const lockResult = await acquireLock(sandbox, executionId, source)

    if (!lockResult.acquired) {
      console.log(`[agent/completion] Lock not acquired for ${executionId} - already being handled`)
      return Response.json({
        success: true,
        handled: false,
        loopContinued: false,
        message: "Completion already being handled by another process",
      })
    }

    try {
      const repoName = branch.repo.name
      const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

      // Run auto-commit-push
      let commitInfo: { committed: boolean; pushed: boolean; commitMessage?: string; error?: string } | null = null

      if (status === "completed" || stopped) {
        // Get GitHub token for the user
        const githubToken = await getGitHubTokenForUser(branch.sandbox.userId)

        if (githubToken) {
          commitInfo = await runAutoCommitPush(
            sandbox,
            repoPath,
            branch.name,
            branch.sandbox.userId,
            githubToken
          )

          if (commitInfo.error) {
            console.error(`[agent/completion] Auto-commit-push error: ${commitInfo.error}`)
          } else if (commitInfo.committed) {
            console.log(`[agent/completion] Auto-committed: ${commitInfo.commitMessage}`)
          }
        } else {
          console.log(`[agent/completion] No GitHub token for user ${branch.sandbox.userId}`)
        }
      }

      // Update execution record as completed
      await prisma.agentExecution.update({
        where: { id: executionId },
        data: {
          status: status === "completed" ? EXECUTION_STATUS.COMPLETED : EXECUTION_STATUS.ERROR,
          completedAt: new Date(),
        },
      })

      // Check if loop should continue (skip if user manually stopped)
      const shouldContinueLoop =
        !stopped &&
        branch.loopEnabled &&
        status === "completed" &&
        (branch.loopCount || 0) < (branch.loopMaxIterations || 10) &&
        !isLoopFinished(content)

      if (shouldContinueLoop) {
        console.log(`[agent/completion] Continuing loop for branch ${branch.id}`)

        // Increment loop count and set status to running
        const newLoopCount = (branch.loopCount || 0) + 1
        await prisma.branch.update({
          where: { id: branchId },
          data: {
            status: BRANCH_STATUS.RUNNING,
            loopCount: newLoopCount,
          },
        })

        // Trigger loop continuation
        await triggerLoopContinuation(branch, daytonaApiKey)

        return Response.json({
          success: true,
          handled: true,
          loopContinued: true,
          commitInfo: commitInfo ? {
            committed: commitInfo.committed,
            pushed: commitInfo.pushed,
            commitMessage: commitInfo.commitMessage,
          } : undefined,
        })
      }

      // Normal completion - set status to idle
      const loopUpdates = branch.loopEnabled ? { loopCount: 0 } : {}
      await prisma.branch.update({
        where: { id: branchId },
        data: {
          status: BRANCH_STATUS.IDLE,
          // If stopped, also disable loop mode
          ...(stopped ? { loopEnabled: false, loopCount: 0 } : loopUpdates),
        },
      })

      console.log(`[agent/completion] Completion handled for ${executionId}, status set to idle`)

      return Response.json({
        success: true,
        handled: true,
        loopContinued: false,
        commitInfo: commitInfo ? {
          committed: commitInfo.committed,
          pushed: commitInfo.pushed,
          commitMessage: commitInfo.commitMessage,
        } : undefined,
      })

    } finally {
      // Always release the lock
      await releaseLock(sandbox, executionId)
    }

  } catch (error) {
    console.error(`[agent/completion] Error processing completion for ${executionId}:`, error)
    return internalError(error)
  }
}

/**
 * Trigger loop continuation - starts a new agent execution
 */
async function triggerLoopContinuation(
  branch: {
    id: string
    name: string
    agent: string | null
    model: string | null
    loopCount: number | null
    loopMaxIterations: number | null
    repo: { id: string; name: string }
    sandbox: {
      id: string
      sandboxId: string
      userId: string
      sessionId: string | null
      sessionAgent: string | null
      previewUrlPattern: string | null
      user: {
        credentials: {
          anthropicApiKey: string | null
          anthropicAuthToken: string | null
          anthropicAuthType: string | null
          openaiApiKey: string | null
          opencodeApiKey: string | null
          daytonaApiKey: string | null
        } | null
      }
    } | null
  },
  daytonaApiKey: string
): Promise<void> {
  if (!branch.sandbox) {
    throw new Error("No sandbox for branch")
  }

  const sandbox = branch.sandbox
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, opencodeApiKey } =
    decryptUserCredentials(sandbox.user.credentials)

  const agent = (branch.agent as Agent) || "claude-code"
  const model = branch.model || undefined
  const repoName = branch.repo.name
  const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

  // Create user continuation message
  await prisma.message.create({
    data: {
      branchId: branch.id,
      role: "user",
      content: LOOP_CONTINUATION_MESSAGE,
    },
  })

  // Create assistant placeholder message
  const assistantMessage = await prisma.message.create({
    data: {
      branchId: branch.id,
      role: "assistant",
      content: "",
    },
  })

  // Ensure sandbox is ready with credentials
  const { sandbox: daytonaSandbox, resumeSessionId, env } = await ensureSandboxReady(
    daytonaApiKey,
    sandbox.sandboxId,
    repoName,
    sandbox.previewUrlPattern || undefined,
    anthropicApiKey,
    anthropicAuthType,
    anthropicAuthToken,
    sandbox.sessionId || undefined,
    sandbox.sessionAgent || undefined,
    openaiApiKey,
    agent,
    model,
    opencodeApiKey,
    branch.repo.id
  )

  // Create background session
  const bgSession = await createBackgroundAgentSession(daytonaSandbox, {
    repoPath,
    previewUrlPattern: sandbox.previewUrlPattern || undefined,
    sessionId: resumeSessionId,
    agent,
    model,
  })

  // Update session ID if changed
  if (sandbox.sessionId !== bgSession.backgroundSessionId || sandbox.sessionAgent !== agent) {
    await prisma.sandbox.update({
      where: { id: sandbox.id },
      data: { sessionId: bgSession.backgroundSessionId, sessionAgent: agent },
    })
  }

  // Create execution record
  await prisma.agentExecution.create({
    data: {
      messageId: assistantMessage.id,
      sandboxId: sandbox.sandboxId,
      status: EXECUTION_STATUS.RUNNING,
      isLoopIteration: true,
    },
  })

  // Update sandbox status
  await updateSandboxAndBranchStatus(
    sandbox.id,
    branch.id,
    BRANCH_STATUS.RUNNING,
    { lastActiveAt: new Date() }
  )

  // Start the agent with fresh env
  await bgSession.start(LOOP_CONTINUATION_MESSAGE, { env })

  console.log(`[agent/completion] Loop continuation started for branch ${branch.id}`)
}
