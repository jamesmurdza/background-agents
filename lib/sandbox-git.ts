import type { Sandbox } from "@daytonaio/sdk"
import { generateCommitMessage } from "@/lib/commit-message"

export interface AutoCommitPushResult {
  committed: boolean
  pushed: boolean
  commitMessage?: string
  error?: string
}

/**
 * Push with retry logic for transient errors.
 * Returns the raw error message on failure so the caller can decide how to surface it.
 */
export async function pushWithRetry(
  sandbox: Sandbox,
  repoPath: string,
  githubToken: string,
  maxRetries = 2
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await sandbox.git.push(repoPath, "x-access-token", githubToken)
      return { success: true }
    } catch (err: unknown) {
      const axiosResponse = (err as { response?: { data?: unknown } })?.response
      let errorMessage = err instanceof Error ? err.message : String(err)

      if (axiosResponse?.data) {
        const data = axiosResponse.data
        if (typeof data === "string") {
          errorMessage = data
        } else if (typeof data === "object" && data !== null) {
          const dataObj = data as { message?: string; error?: string }
          errorMessage = dataObj.message || dataObj.error || JSON.stringify(data)
        }
      }

      const isTransient =
        errorMessage.includes("timeout") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ECONNRESET") ||
        errorMessage.includes("503") ||
        errorMessage.includes("502")

      if (isTransient && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }

      return { success: false, error: errorMessage }
    }
  }

  return { success: false, error: "Max retries exceeded" }
}

/**
 * Stage, commit, and push any pending git changes in the sandbox.
 * This helper never throws for normal git failures; it returns them as an error string.
 */
export async function autoCommitPush(params: {
  sandbox: Sandbox
  repoPath: string
  githubToken: string
  userId: string
}): Promise<AutoCommitPushResult> {
  const { sandbox, repoPath, githubToken, userId } = params

  const currentStatus = await sandbox.git.status(repoPath)
  const currentBranch = currentStatus.currentBranch
  if (!currentBranch) {
    return {
      committed: false,
      pushed: false,
      error: "Could not determine current branch",
    }
  }

  let committed = false
  let commitMessage = ""

  const statusResult = await sandbox.process.executeCommand(
    `cd ${repoPath} && git status --porcelain 2>&1`
  )

  if (!statusResult.exitCode && statusResult.result.trim()) {
    await sandbox.process.executeCommand(`cd ${repoPath} && git add -A 2>&1`)

    const diffResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git diff --cached --no-color 2>&1`
    )
    const diff = diffResult.exitCode ? "" : diffResult.result

    const commitMessageResult = await generateCommitMessage({
      userId,
      diff,
    })
    commitMessage = commitMessageResult.message

    const escapedMessage = commitMessage.replace(/'/g, "'\\''")
    const commitResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git commit -m '${escapedMessage}' 2>&1`
    )

    if (commitResult.exitCode) {
      return {
        committed: false,
        pushed: false,
        commitMessage,
        error: "Commit failed: " + commitResult.result,
      }
    }

    committed = true
  }

  const localHead = await sandbox.process.executeCommand(
    `cd ${repoPath} && git rev-parse HEAD 2>/dev/null`
  )
  const remoteHead = await sandbox.process.executeCommand(
    `cd ${repoPath} && git ls-remote origin refs/heads/${currentBranch} 2>/dev/null | cut -f1`
  )
  const localSha = localHead.result.trim()
  const remoteSha = remoteHead.result.trim()
  const needsPush = !!localSha && localSha !== remoteSha

  let pushed = false
  if (needsPush) {
    const pushResult = await pushWithRetry(sandbox, repoPath, githubToken)
    if (!pushResult.success) {
      return {
        committed,
        pushed: false,
        commitMessage,
        error: "Push failed: " + pushResult.error,
      }
    }
    pushed = true
  }

  return {
    committed,
    pushed,
    commitMessage: commitMessage || undefined,
  }
}
