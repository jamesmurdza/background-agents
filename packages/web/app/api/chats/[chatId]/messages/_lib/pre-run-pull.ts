import { NEW_REPOSITORY } from "@/lib/types"
import { autoPullBeforeRun } from "@/lib/server/auto-pull"
import { createGitOperationMessage } from "@/lib/db/git-messages"
import type { SandboxLike } from "@background-agents/sandbox-git"
import type { ChatRecord } from "./types"

/**
 * Auto-pull the branch before the agent runs so commits pushed from elsewhere
 * (local checkout, another chat, the GitHub UI) are present in the sandbox. A
 * freshly created sandbox was just cloned, so it's already current — callers
 * skip it there by not satisfying the guard below.
 *
 * Returns either:
 *  - a `Response` (409 PULL_CONFLICT) when *this* send started a merge that
 *    conflicted — the merge is left in progress and the agent is NOT started, so
 *    the client surfaces the existing merge-conflict UI; or
 *  - `{ pullConflictNote }`, a (possibly empty) prefix to prepend to the prompt
 *    when a prior conflicted merge is still in progress and should be handed to
 *    the agent to resolve this turn.
 *
 * Never throws: a failed auto-pull is swallowed so a turn is never blocked on it.
 */
export async function runPreRunPull(params: {
  sandbox: SandboxLike
  repoPath: string
  chat: ChatRecord
  chatId: string
  branch: string | null
  githubToken: string | null
  createdSandbox: boolean
}): Promise<{ pullConflictNote: string } | Response> {
  const { sandbox, repoPath, chat, chatId, branch, githubToken, createdSandbox } = params

  let pullConflictNote = ""
  if (
    !createdSandbox &&
    branch &&
    chat.repo !== NEW_REPOSITORY &&
    chat.repo !== "__new__" &&
    githubToken
  ) {
    try {
      const pull = await autoPullBeforeRun(sandbox, repoPath, branch, githubToken)

      if (pull.status === "pulled") {
        await createGitOperationMessage(
          chatId,
          `Pulled ${pull.commits} commit${pull.commits === 1 ? "" : "s"} from ${branch}.`,
          false,
          undefined,
          branch
        )
      } else if (pull.status === "conflict" && !pull.alreadyInProgress) {
        // This send started the merge and it conflicted. Leave the merge in
        // progress, surface the existing conflict UI, and do NOT start the
        // agent or persist messages — the user decides (send a message to
        // have the agent resolve it, or Abort Merge).
        const fileList = pull.conflictedFiles.join(", ")
        await createGitOperationMessage(
          chatId,
          `Pull conflict on ${branch} (${pull.conflictedFiles.length} file${pull.conflictedFiles.length === 1 ? "" : "s"}): ${fileList}`,
          true
        )
        return Response.json(
          {
            error: "PULL_CONFLICT",
            conflictedFiles: pull.conflictedFiles,
            branch,
          },
          { status: 409 }
        )
      } else if (pull.status === "conflict" && pull.alreadyInProgress) {
        // A prior conflicted pull is still in progress and the user sent a
        // message — hand the conflict to the agent to resolve this turn.
        const fileList = pull.conflictedFiles.join(", ")
        pullConflictNote =
          `A merge of origin/${branch} is in progress with conflicts in: ${fileList}. ` +
          `Resolve the conflicts, commit the merge, then address the request below.\n\n---\n\n`
      }
    } catch (err) {
      // Never block a turn on the auto-pull. If it fails, the agent runs on
      // the current tree and the end-of-turn push surfaces any divergence.
      console.error("[chats/messages] auto-pull failed:", err)
    }
  }

  return { pullConflictNote }
}
