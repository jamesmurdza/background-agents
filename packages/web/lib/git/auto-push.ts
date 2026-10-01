import {
  createSandboxGit,
  type SandboxLike,
  GitAuthError,
  GitNotFoundError,
  GitError,
  isNonFastForwardError,
} from "@background-agents/sandbox-git"
import { getGitHubToken } from "@/lib/github/oauth-token"
import { getUserPushOptions } from "@/lib/git/push-options"
import { isInConflictState } from "@/lib/git/sandbox-git-ops"
import {
  clearPushFailureMessages,
  createPushFailedMessage,
} from "@/lib/db/git-messages"
import { logGitPushError } from "@/lib/db/activity-log"

/** Client-notification payload for a push that advanced the remote. */
export interface PushInfo {
  branch: string
  commits: number
  commitSha?: string
}

/**
 * Fixed, short delay before the single inline retry (see {@link isRetryablePushError}).
 * autoPushChat runs inline before the caller releases the chat from "running"
 * (and, on the SSE path, before the "turn complete" event is sent), so this is
 * deliberately a small fixed delay rather than exponential backoff — it must
 * not meaningfully hold up the UI. Failures that survive this one retry are
 * left to a later user turn or a manual force-push, same as before.
 */
const PUSH_RETRY_DELAY_MS = 750

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether a push failure is worth the one bounded retry above.
 *
 * Auth failures need the user to relink GitHub, and non-fast-forward
 * rejections mean the remote has genuinely diverged — retrying an identical
 * push cannot fix either, so only unclassified failures (network blips,
 * GitHub 5xx responses, timeouts) are retried.
 */
function isRetryablePushError(err: unknown): boolean {
  if (err instanceof GitAuthError || err instanceof GitNotFoundError) return false
  const output = err instanceof GitError ? err.output : err instanceof Error ? err.message : ""
  return !isNonFastForwardError(output)
}

/**
 * Auto-push a completed turn to its remote branch, and reconcile the chat's git
 * messages.
 *
 * This is the single backend routine for post-turn pushing. Both finalizers call
 * it — the SSE stream (fast, while a client watches) and the agent-lifecycle
 * cron (the always-on fallback for unwatched runs) — so the behaviour is
 * identical no matter who detected completion first:
 *
 * - skips while a merge/rebase is in progress (mid-conflict HEAD is partial);
 * - retries once, after a short fixed delay, when the failure looks transient
 *   (see {@link isRetryablePushError}) — auth failures and genuine
 *   non-fast-forward rejections are not retried since a second identical
 *   attempt can't fix either;
 * - on a failed push (including a retry that also failed), records ONE
 *   deduped "Push failed" chat message AND a "git_push_failed" ActivityLog
 *   row (see {@link logGitPushError}) for aggregate/admin visibility;
 * - on a push that advances the remote, clears any stale failure and returns the
 *   {@link PushInfo} so a watching client can raise a notification.
 *
 * Callers MUST invoke this BEFORE releasing the chat from "running"
 * (backgroundSessionId → null). Releasing first excludes the cron fallback, so a
 * crash between release and push would strand the commits until the next turn.
 *
 * Returns null when nothing was pushed (no branch, no token, conflict, failure,
 * or already up to date).
 *
 * Never throws: callers run it right before releasing the chat from "running",
 * so an unexpected error here must not skip that release. A push failure is
 * recorded as a message; any other error is swallowed (logged), leaving the
 * cron fallback to retry on a later turn.
 */
export async function autoPushChat(params: {
  sandbox: SandboxLike
  repoPath: string
  chatId: string
  userId: string
  branch: string
}): Promise<PushInfo | null> {
  const { sandbox, repoPath, chatId, userId, branch } = params

  try {
    // Skip while a merge/rebase is unresolved — HEAD isn't a pushable snapshot.
    if (await isInConflictState(sandbox, repoPath)) return null

    const token = await getGitHubToken(userId)
    if (!token) return null

    const git = createSandboxGit(sandbox)
    const pushOptions = await getUserPushOptions(userId)
    // `--porcelain` tells us whether the remote ref actually advanced.
    const attemptPush = () => git.push(repoPath, token, pushOptions)

    // Record a push we're giving up on: a deduped chat message (as before)
    // plus an ActivityLog row for aggregate/admin visibility, same pattern as
    // logLlmProviderError. Called once we've truly given up — not per
    // attempt — so a blip that resolves on retry never shows up here.
    const giveUp = async (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error"
      await createPushFailedMessage(chatId, message)
      logGitPushError({ userId, chatId, branch, error: message })
      return null
    }

    let result
    try {
      result = await attemptPush()
    } catch (err) {
      if (!isRetryablePushError(err)) return await giveUp(err)
      await sleep(PUSH_RETRY_DELAY_MS)
      try {
        result = await attemptPush()
      } catch (retryErr) {
        return await giveUp(retryErr)
      }
    }

    if (!result.updated) return null // e.g. "Everything up-to-date"

    // A push landed — drop any stale failure + its dead force-push link.
    await clearPushFailureMessages(chatId)

    // Best-effort commit count + sha for the client notification.
    const range = result.range ?? "HEAD --not --remotes=origin"
    const countRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-list --count ${range} 2>/dev/null || echo 0`
    )
    const commits = parseInt(countRes.result.trim() || "0", 10) || 0

    const headRes = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-parse --short HEAD 2>/dev/null || echo ""`
    )
    const commitSha = headRes.result.trim() || undefined

    return { branch, commits, commitSha }
  } catch (err) {
    console.error(`[auto-push] Unexpected error for chat ${chatId}:`, err)
    return null
  }
}
