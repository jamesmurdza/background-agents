import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import { ensureSandboxRunning } from "@/lib/sandbox"
import type { TurnSecret } from "@/lib/server/turn-secrets"
import type { ChatRecord, MessagePayload } from "./types"

type DaytonaSandbox = Awaited<ReturnType<Daytona["get"]>>

/**
 * Mutable sandbox bookkeeping shared with the POST handler. The handler seeds it
 * from the chat row and reads it back in its `catch` so a sandbox newly created
 * during this request can be torn down if a *later* stage throws — which is why
 * this is a mutated object rather than only a return value.
 */
export interface SandboxState {
  sandboxId: string | null
  branch: string | null
  previewUrlPattern: string | null
  createdSandbox: boolean
}

export interface EnsuredSandbox {
  sandbox: DaytonaSandbox
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  createdSandbox: boolean
  /**
   * Set only when `createdSandbox` is true and a branch restore was attempted.
   * `true` — fetched the branch's real prior state from remote.
   * `false` — the restore fetch/checkout failed and fell back to a fresh
   * branch off `baseBranch`, which can be *behind* the branch's real remote
   * tip. Callers that skip a pre-run pull for "freshly created" sandboxes
   * must not do so when this is `false`.
   * `undefined` — no restore was attempted (first-time creation, or
   * NEW_REPOSITORY with nothing to restore).
   */
  branchRestored?: boolean
}

/**
 * Ensure the chat has a live, started sandbox.
 *
 * If the chat already has a sandbox we reuse it. Otherwise — whether the chat
 * never had one, or its sandbox was deleted out from under us (e.g. by the
 * cleanup cron, surfacing as a 404 from `daytona.get`) — we create a fresh one
 * through the *same* path. A deleted sandbox is just a chat with no usable
 * sandbox; recreating it is identical to first-time creation except that we
 * restore the chat's existing branch when it has one. (This is why there is no
 * separate "recreate" branch with its own rules: a divergent recreate path used
 * to reject things first-time creation happily handles — e.g. local
 * `NEW_REPOSITORY` chats — so the first message after a deletion failed with
 * SANDBOX_NOT_FOUND and only the *retry* succeeded by falling through to
 * creation.)
 *
 * Keeps `state` in sync as it goes so a throw mid-flight leaves the handler
 * enough to clean up, and installs the repo's skills on a newly created sandbox.
 *
 * Returns the started sandbox + resolved ids, or a `Response`
 * (410 SANDBOX_NOT_FOUND) when no sandbox can be created (a cloned repo with no
 * GitHub token to clone from).
 */
export async function ensureSandboxForChat(params: {
  daytona: Daytona
  chat: ChatRecord
  chatId: string
  payload: MessagePayload
  githubToken: string | null
  userId: string
  state: SandboxState
  /** The turn's secrets, to mount if a sandbox has to be created. */
  turnSecrets?: TurnSecret[]
}): Promise<EnsuredSandbox | Response> {
  const { daytona, chat, chatId, payload, githubToken, userId, state, turnSecrets } = params

  // The reuse-or-create core (same checks, same order of operations) lives in
  // the shared `ensureSandboxRunning` — this wrapper only layers the
  // message-send-specific bookkeeping (SandboxState, in-memory sessionId,
  // keeping the chat in "creating" rather than "idle" until persistTurn marks
  // the turn running) on top.
  const result = await ensureSandboxRunning({
    daytona,
    chat: {
      id: chatId,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: state.branch,
      sandboxId: state.sandboxId,
      previewUrlPattern: state.previewUrlPattern,
    },
    userId,
    githubToken,
    turnSecrets,
    newBranchHint: payload.newBranch,
  })

  if (!result) {
    // The one genuinely unrecoverable case: a cloned repo with no GitHub
    // token to (re)clone from. ensureSandboxRunning already persisted the
    // chat row as sandboxId: null / status: "error".
    return Response.json(
      { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
      { status: 410 }
    )
  }

  const { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox, branchRestored } = result
  const resolvedPreviewUrlPattern = previewUrlPattern ?? null

  if (createdSandbox) {
    state.sandboxId = sandboxId
    state.branch = branch
    state.previewUrlPattern = resolvedPreviewUrlPattern
    state.createdSandbox = true

    // A freshly created sandbox is a clean clone with no agent conversation
    // history on disk. ensureSandboxRunning already cleared sessionId in the
    // DB; mirror that in memory too so this request's resume read below
    // doesn't try to resume a session the CLI can't find.
    chat.sessionId = null

    // ensureSandboxRunning marks the chat row "idle" once the sandbox is up,
    // since it has no notion of an in-flight message. The message path isn't
    // done yet — keep the per-chat send claim by moving status back to
    // "creating" until persistTurn marks the turn running.
    await prisma.chat.update({ where: { id: chatId }, data: { status: "creating" } })
  }

  return {
    sandbox,
    sandboxId,
    branch,
    previewUrlPattern: resolvedPreviewUrlPattern,
    createdSandbox,
    branchRestored,
  }
}
