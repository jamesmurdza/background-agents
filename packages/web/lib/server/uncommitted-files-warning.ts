import type { SandboxLike } from "@background-agents/sandbox-git"
import { prisma } from "@/lib/db/prisma"
import { inspectGitWorkingTree, type GitWorkingTreeStatus } from "@/lib/git/uncommitted-files"

/** Persist the current warning only while this completed turn still owns the
 * chat. SSE reconnects and cron may both finalize, so a conditional update is
 * safer than appending messages or trusting whichever finalizer finishes last. */
export async function refreshUncommittedFilesWarning(params: {
  sandbox: SandboxLike
  repoPath: string
  chatId: string
  backgroundSessionId: string
}): Promise<GitWorkingTreeStatus | undefined> {
  const { sandbox, repoPath, chatId, backgroundSessionId } = params
  const status = await inspectGitWorkingTree(sandbox, repoPath)
  if (!status) return undefined

  try {
    const update = await prisma.chat.updateMany({
      where: { id: chatId, backgroundSessionId },
      data: status,
    })
    return update.count > 0 ? status : undefined
  } catch (error) {
    console.error(`[uncommitted-files] Could not save warning for chat ${chatId}:`, error)
    return undefined
  }
}
