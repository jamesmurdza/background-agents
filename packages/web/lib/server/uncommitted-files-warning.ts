import type { SandboxLike } from "@background-agents/sandbox-git"
import { prisma } from "@/lib/db/prisma"
import { inspectUncommittedFiles, hasAnyCommits } from "@/lib/git/uncommitted-files"

export interface UncommittedFilesWarning {
  uncommittedFilesCount: number
  hasCommits: boolean
}

/** Persist the current warning only while this completed turn still owns the
 * chat. SSE reconnects and cron may both finalize, so a conditional update is
 * safer than appending messages or trusting whichever finalizer finishes last.
 *
 * Checks both uncommittedFilesCount and hasCommits — a repo can have zero
 * uncommitted files yet still hold commits that only exist in the sandbox,
 * which the no-linked-repo banner needs to know about just as much as dirty
 * files. If either check fails (sandbox stalled, Git error), the whole
 * refresh is skipped so the chat keeps its last known combined state rather
 * than one field going stale relative to the other. */
export async function refreshUncommittedFilesWarning(params: {
  sandbox: SandboxLike
  repoPath: string
  chatId: string
  backgroundSessionId: string
}): Promise<UncommittedFilesWarning | undefined> {
  const { sandbox, repoPath, chatId, backgroundSessionId } = params
  const [uncommittedFilesCount, hasCommits] = await Promise.all([
    inspectUncommittedFiles(sandbox, repoPath),
    hasAnyCommits(sandbox, repoPath),
  ])
  if (uncommittedFilesCount === null || hasCommits === null) return undefined

  try {
    const update = await prisma.chat.updateMany({
      where: { id: chatId, backgroundSessionId },
      data: { uncommittedFilesCount, hasCommits },
    })
    return update.count > 0 ? { uncommittedFilesCount, hasCommits } : undefined
  } catch (error) {
    console.error(`[uncommitted-files] Could not save warning for chat ${chatId}:`, error)
    return undefined
  }
}
