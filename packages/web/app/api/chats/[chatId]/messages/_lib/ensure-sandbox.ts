import { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import { resolveEnvironmentForChat } from "@/lib/environments"
import {
  createSandboxForChat,
  ensureSandboxStarted,
  installSkillsForRepo,
} from "@/lib/sandbox"
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
}): Promise<EnsuredSandbox | Response> {
  const { daytona, chat, chatId, payload, githubToken, userId, state } = params

  let sandboxId = state.sandboxId
  let branch = state.branch
  let previewUrlPattern = state.previewUrlPattern

  // ── Reuse the chat's existing sandbox if it's still there ──────────────
  let sandbox: DaytonaSandbox | null = null
  if (sandboxId) {
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      // The recorded sandbox is gone (deleted out from under us). Fall through
      // and create a fresh one below, restoring the branch if we have one.
      console.log(`[chats/messages] Sandbox ${sandboxId} not found for chat ${chatId}; creating a new one`)
      sandbox = null
    }
  }

  // ── Otherwise create one (first-time *or* recreation — same path) ──────
  let createdSandbox = false
  if (!sandbox) {
    const isNewRepo = chat.repo === NEW_REPOSITORY || chat.repo === "__new__"

    // A cloned repo can only be (re)created with a token to clone it. This is
    // the one genuinely unrecoverable case — everything else we can build.
    if (!isNewRepo && !githubToken) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
        { status: 410 }
      )
    }

    await prisma.chat.update({
      where: { id: chatId },
      data: { status: "creating" },
    })

    // Restore the chat's branch when it has one (recreation); otherwise create
    // a fresh branch (first message of a new chat).
    const restoreExistingBranch = !!branch
    const newBranch = branch ?? payload.newBranch ?? `agent/${randomUUID().slice(0, 8)}`

    // Resolve the chat's environment (pinned, or the repo's default). Null only
    // for NEW_REPOSITORY chats.
    const environment = await resolveEnvironmentForChat({
      userId,
      repo: chat.repo,
      environmentId: chat.environmentId ?? null,
    })

    const created = await createSandboxForChat({
      daytona,
      repo: chat.repo,
      baseBranch: chat.baseBranch ?? "main",
      newBranch,
      githubToken: githubToken ?? undefined,
      userId,
      restoreExistingBranch,
      environment,
    })

    sandbox = created.sandbox
    sandboxId = created.sandboxId
    branch = created.branch
    previewUrlPattern = created.previewUrlPattern ?? null
    createdSandbox = true
    state.sandboxId = sandboxId
    state.branch = branch
    state.previewUrlPattern = previewUrlPattern
    state.createdSandbox = true

    // A freshly created sandbox is a clean clone with no agent conversation
    // history on disk. Drop any stale session pointer so the agent starts a new
    // conversation instead of resuming a session the CLI can't find ("No
    // conversation found with session ID"). Clear it both in the DB (future
    // requests) and in memory (this request's resume read below). Agent-
    // agnostic: sessionId is the generic resume pointer used by every agent.
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        sandboxId,
        branch,
        previewUrlPattern,
        sessionId: null,
        status: "ready",
      },
    })
    chat.sessionId = null
  }

  await ensureSandboxStarted(sandbox)

  // On a newly created sandbox (first-time or recreation), install all skills
  // associated with this user+repo so the agent has them from the first prompt.
  if (createdSandbox && chat.repo !== NEW_REPOSITORY) {
    await installSkillsForRepo(sandbox, userId, chat.repo)
  }

  return { sandbox, sandboxId: sandboxId as string, branch, previewUrlPattern, createdSandbox }
}
