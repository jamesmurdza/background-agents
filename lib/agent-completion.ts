import { prisma } from "@/lib/prisma"
import { INCLUDE_EXECUTION_WITH_CONTEXT, type ExecutionWithContext } from "@/lib/prisma-includes"
import { EXECUTION_STATUS, PATHS } from "@/lib/constants"
import { ensureSandboxReady, ensureSandboxStarted } from "@/lib/sandbox-resume"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import {
  decryptUserCredentials,
  getDaytonaApiKey,
  getGitHubTokenForUser,
  isDaytonaKeyError,
  resetSandboxStatus,
  updateSandboxAndBranchStatus,
} from "@/lib/api-helpers"
import { autoCommitPush, type AutoCommitPushResult } from "@/lib/sandbox-git"
import { isLoopFinished, LOOP_CONTINUATION_MESSAGE, type Agent } from "@/lib/types"

type CompletionSource = "client" | "cron"

export interface AgentCompletionInput {
  branchId: string
  executionId: string
  status: "completed" | "error"
  content?: string
  source: CompletionSource
  stopped?: boolean
}

export interface AgentCompletionResult {
  success: boolean
  handled: boolean
  loopContinued: boolean
  loopContinuationRequired?: boolean
  commitInfo?: AutoCommitPushResult
}

const COMPLETION_LOCK_STALE_MS = 60_000

function getLockPath(executionId: string): string {
  return `${PATHS.AGENT_COMPLETION_LOCK_PREFIX}${executionId}.lock`
}

async function loadExecutionForCompletion(executionId: string): Promise<ExecutionWithContext | null> {
  return prisma.agentExecution.findFirst({
    where: {
      OR: [
        { id: executionId },
        { executionId },
      ],
    },
    include: INCLUDE_EXECUTION_WITH_CONTEXT,
  })
}

async function acquireCompletionLock(
  sandboxId: string,
  executionId: string,
  source: CompletionSource
): Promise<boolean> {
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) {
    throw new Error("DAYTONA_API_KEY not configured")
  }

  const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)
  const lockPath = getLockPath(executionId)
  const lockPayload = JSON.stringify({
    executionId,
    source,
    lockedAt: Date.now(),
  })
  const lockPayloadB64 = Buffer.from(lockPayload, "utf8").toString("base64")

  const result = await sandbox.process.executeCommand(
    `python3 - <<'PY'
import base64
import json
import os
import time

path = ${JSON.stringify(lockPath)}
payload_b64 = ${JSON.stringify(lockPayloadB64)}
stale_ms = ${String(COMPLETION_LOCK_STALE_MS)}
now = int(time.time() * 1000)

if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        locked_at = int(data.get("lockedAt", 0))
    except Exception:
        locked_at = 0

    if locked_at and now - locked_at <= stale_ms:
        print("LOCKED")
        raise SystemExit(0)

    try:
        os.remove(path)
    except FileNotFoundError:
        pass

try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print("LOCKED")
else:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(base64.b64decode(payload_b64).decode("utf-8"))
    print("ACQUIRED")
PY`
  )

  return result.result.trim() === "ACQUIRED"
}

async function releaseCompletionLock(sandboxId: string, executionId: string): Promise<void> {
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) {
    return
  }

  try {
    const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)
    await sandbox.process.executeCommand(`rm -f ${getLockPath(executionId)}`)
  } catch {
    // Best effort.
  }
}

async function continueLoopExecution(execution: NonNullable<ExecutionWithContext>): Promise<boolean> {
  const branch = execution.message.branch
  const sandboxRecord = branch.sandbox

  if (!sandboxRecord) {
    return false
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) {
    throw new Error("DAYTONA_API_KEY not configured")
  }

  const {
    anthropicApiKey,
    anthropicAuthToken,
    anthropicAuthType,
    openaiApiKey,
    opencodeApiKey,
  } = decryptUserCredentials(sandboxRecord.user.credentials)

  const agent = (branch.agent as Agent) || "claude-code"
  const model = branch.model || undefined
  const repoName = branch.repo.name
  const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
  const loopCount = branch.loopCount || 0

  const newMessage = await prisma.message.create({
    data: {
      branchId: branch.id,
      role: "user",
      content: LOOP_CONTINUATION_MESSAGE,
    },
  })

  const assistantMessage = await prisma.message.create({
    data: {
      branchId: branch.id,
      role: "assistant",
      content: "",
    },
  })

  await prisma.branch.update({
    where: { id: branch.id },
    data: {
      status: "running",
      loopCount: loopCount + 1,
    },
  })

  try {
    const { sandbox: daytonaSandbox, resumeSessionId, env } = await ensureSandboxReady(
      daytonaApiKey,
      sandboxRecord.sandboxId,
      repoName,
      sandboxRecord.previewUrlPattern || undefined,
      anthropicApiKey,
      anthropicAuthType,
      anthropicAuthToken,
      sandboxRecord.sessionId || undefined,
      sandboxRecord.sessionAgent || undefined,
      openaiApiKey,
      agent,
      model,
      opencodeApiKey,
      branch.repo.id
    )

    const bgSession = await createBackgroundAgentSession(daytonaSandbox, {
      repoPath,
      previewUrlPattern: sandboxRecord.previewUrlPattern || undefined,
      sessionId: resumeSessionId,
      agent,
      model,
    })

    if (sandboxRecord.sessionId !== bgSession.backgroundSessionId || sandboxRecord.sessionAgent !== agent) {
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { sessionId: bgSession.backgroundSessionId, sessionAgent: agent },
      })
    }

    await prisma.agentExecution.create({
      data: {
        messageId: assistantMessage.id,
        sandboxId: sandboxRecord.sandboxId,
        status: "running",
        isLoopIteration: true,
      },
    })

    await updateSandboxAndBranchStatus(
      sandboxRecord.id,
      branch.id,
      "running",
      { lastActiveAt: new Date() }
    )

    await bgSession.start(LOOP_CONTINUATION_MESSAGE, { env })
    return true
  } catch (error) {
    await prisma.message.deleteMany({
      where: {
        id: {
          in: [newMessage.id, assistantMessage.id],
        },
      },
    }).catch(() => {})
    await resetSandboxStatus(sandboxRecord.id, branch.id)
    throw error
  }
}

export async function processAgentCompletion(input: AgentCompletionInput): Promise<AgentCompletionResult> {
  const execution = await loadExecutionForCompletion(input.executionId)
  if (!execution) {
    throw new Error("Execution not found")
  }

  if (execution.message.branchId !== input.branchId) {
    throw new Error("Execution does not belong to the provided branch")
  }

  if (
    execution.status !== EXECUTION_STATUS.COMPLETED &&
    execution.status !== EXECUTION_STATUS.ERROR
  ) {
    throw new Error(`Execution is not complete (status: ${execution.status})`)
  }

  if (execution.completionHandledAt) {
    return {
      success: true,
      handled: false,
      loopContinued: false,
    }
  }

  const lockAcquired = await acquireCompletionLock(execution.sandboxId, execution.id, input.source)
  if (!lockAcquired) {
    return {
      success: true,
      handled: false,
      loopContinued: false,
    }
  }

  try {
    const freshExecution = await loadExecutionForCompletion(execution.id)
    if (!freshExecution) {
      throw new Error("Execution not found")
    }

    if (freshExecution.completionHandledAt) {
      return {
        success: true,
        handled: false,
        loopContinued: false,
      }
    }

    const branch = freshExecution.message.branch
    const sandboxRecord = branch.sandbox
    const repoName = branch.repo.name
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
    const githubToken = sandboxRecord
      ? await getGitHubTokenForUser(branch.repo.userId)
      : null

    let commitInfo: AutoCommitPushResult | undefined
    if (sandboxRecord && githubToken) {
      const daytonaApiKey = getDaytonaApiKey()
      if (isDaytonaKeyError(daytonaApiKey)) {
        throw new Error("DAYTONA_API_KEY not configured")
      }

      try {
        const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxRecord.sandboxId)
        commitInfo = await autoCommitPush({
          sandbox,
          repoPath,
          githubToken,
          userId: branch.repo.userId,
        })
      } catch (error) {
        commitInfo = {
          committed: false,
          pushed: false,
          error: error instanceof Error ? error.message : "Unknown git error",
        }
      }
    } else if (sandboxRecord && !githubToken) {
      commitInfo = {
        committed: false,
        pushed: false,
        error: "GitHub token not found",
      }
    }

    const responseContent = input.content ?? freshExecution.message.content
    const loopEnabled = branch.loopEnabled
    const loopCount = branch.loopCount || 0
    const loopMaxIterations = branch.loopMaxIterations || 10
    const canContinueLoop =
      !input.stopped &&
      input.status === "completed" &&
      loopEnabled &&
      loopCount < loopMaxIterations &&
      !isLoopFinished(responseContent)

    let loopContinued = false
    let loopContinuationRequired = false

    if (canContinueLoop) {
      if (input.source === "cron") {
        loopContinued = await continueLoopExecution(freshExecution)
      } else {
        loopContinuationRequired = true
      }
    } else {
      const loopUpdates = loopEnabled ? { loopCount: 0 } : {}
      await prisma.branch.update({
        where: { id: branch.id },
        data: {
          status: "idle",
          ...loopUpdates,
        },
      })

      if (sandboxRecord) {
        await prisma.sandbox.update({
          where: { id: sandboxRecord.id },
          data: { status: "idle" },
        })
      }
    }

    await prisma.agentExecution.update({
      where: { id: freshExecution.id },
      data: { completionHandledAt: new Date() },
    })

    return {
      success: true,
      handled: true,
      loopContinued,
      loopContinuationRequired,
      commitInfo,
    }
  } finally {
    await releaseCompletionLock(execution.sandboxId, execution.id)
  }
}
