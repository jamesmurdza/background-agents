/**
 * After an agent run: optional auto-commit + push, then show new git commits in chat.
 * Ported from the pre–useExecutionPoller `useExecutionPolling` hook (see git history before 5451882).
 */

import type { Branch, Message, PushErrorInfo } from "@/lib/shared/types"
import { ASSISTANT_SOURCE, PATHS } from "@/lib/shared/constants"
import { generateId } from "@/lib/shared/store"
import { getExistingCommitHashes, filterNewCommits } from "@/lib/core/git"
import {
  upsertPushErrorSystemMessage,
  clearPushErrorMessages,
} from "@/lib/chat/upsert-push-error-message"

/** One commit-detect run per branch at a time (matches old ref guard). */
const inFlightBranchIds = new Set<string>()

export interface DetectAndShowCommitsParams {
  /** When false, only scans git log for new commits (no commit/push). */
  runAutoCommit?: boolean
  sandboxId: string
  branchId: string
  branchName: string
  repoName: string
  repoOwner: string
  repoApiName: string
  lastShownCommitHash: string | null
  messages: Message[]
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  onUpdateBranch?: (branchId: string, updates: Partial<Branch>) => void
  /** Called only when new commit rows were added to chat (matches legacy behavior). */
  onCommitsDetected?: () => void
  onRefreshGitConflictState?: () => void
}

export async function detectAndShowCommits(params: DetectAndShowCommitsParams): Promise<void> {
  const {
    runAutoCommit = true,
    sandboxId,
    branchId,
    branchName,
    repoName,
    repoOwner,
    repoApiName,
    lastShownCommitHash,
    messages,
    onAddMessage,
    onUpdateMessage,
    onUpdateBranch,
    onCommitsDetected,
    onRefreshGitConflictState,
  } = params

  if (!sandboxId || !branchId || !repoName) return

  if (inFlightBranchIds.has(branchId)) return
  inFlightBranchIds.add(branchId)

  let messagesForDedup = [...messages]

  try {
    if (runAutoCommit) {
      const statusRes = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "check-rebase-status",
        }),
      })
      const statusData = (await statusRes.json().catch(() => ({}))) as {
        inRebase?: boolean
        inMerge?: boolean
      }
      const gitConflictInProgress =
        statusRes.ok && !!(statusData.inRebase || statusData.inMerge)

      if (!gitConflictInProgress) {
        const autoCommitRes = await fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
            action: "auto-commit-push",
            branchId,
          }),
        })

        if (!autoCommitRes.ok) {
          const errorData = (await autoCommitRes.json().catch(() => ({}))) as {
            error?: string
            inRebase?: boolean
            inMerge?: boolean
          }
          const errorMessage = errorData.error || `Push failed (${autoCommitRes.status})`
          const isConflictStateError =
            autoCommitRes.status === 409 &&
            (errorData.inRebase ||
              errorData.inMerge ||
              errorMessage.includes("Merge in progress") ||
              errorMessage.includes("Rebase in progress"))
          const isNothingToCommitNoise =
            /nothing to commit/i.test(errorMessage) &&
            /working tree clean/i.test(errorMessage)

          if (!isConflictStateError && !isNothingToCommitNoise) {
            const pushError: PushErrorInfo = {
              errorMessage,
              branchName,
              sandboxId,
              repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
              repoOwner,
              repoApiName,
            }

            await upsertPushErrorSystemMessage(
              branchId,
              messagesForDedup,
              `::icon-warning:: **Push failed:** ${errorMessage}`,
              pushError,
              {
                onUpdateMessage,
                onAddMessage,
                generateId,
              }
            )
          }
        } else {
          await clearPushErrorMessages(branchId, messagesForDedup, onUpdateMessage)
        }
      }
    }

    if (lastShownCommitHash) {
      const logRes = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "log",
          sinceCommit: lastShownCommitHash,
        }),
      })
      const logData = await logRes.json()
      const allCommits: { shortHash: string; message: string }[] = logData.commits || []

      const messagesForDedupInput = messagesForDedup.map((m) => ({
        id: m.id,
        commitHash: m.commitHash,
      }))
      const existingHashes = getExistingCommitHashes(messagesForDedupInput)
      const newCommits = filterNewCommits(allCommits, existingHashes)

      for (const c of newCommits) {
        const commitMessage: Message = {
          id: generateId(),
          role: "assistant",
          assistantSource: ASSISTANT_SOURCE.COMMIT,
          content: "",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          commitHash: c.shortHash,
          commitMessage: c.message,
        }
        await onAddMessage(branchId, commitMessage)
        messagesForDedup = [...messagesForDedup, commitMessage]
      }

      if (newCommits.length > 0 && allCommits[0]) {
        onUpdateBranch?.(branchId, { lastShownCommitHash: allCommits[0].shortHash })
        onCommitsDetected?.()
      }
    }
  } catch {
    // Non-critical — commit detection failure should not break the run
  } finally {
    onRefreshGitConflictState?.()
    inFlightBranchIds.delete(branchId)
  }
}
