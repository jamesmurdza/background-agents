import { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
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
 * Ensure the chat has a live, started sandbox: create one if the chat has none,
 * or transparently recreate one that was deleted out from under us (e.g. by the
 * cleanup cron). Keeps `state` in sync as it goes — so a throw mid-flight leaves
 * the handler enough to clean up — and, on a newly created sandbox, installs the
 * repo's skills.
 *
 * Returns the started sandbox + resolved ids, or a `Response`
 * (410 SANDBOX_NOT_FOUND) when a deleted sandbox cannot be recreated.
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
  let createdSandbox = false

  // ── Stage 1: ensure sandbox ────────────────────────────────────────────
  if (!sandboxId) {
    await prisma.chat.update({
      where: { id: chatId },
      data: { status: "creating" },
    })

    const newBranch = payload.newBranch ?? `agent/${randomUUID().slice(0, 8)}`
    const created = await createSandboxForChat({
      daytona,
      repo: chat.repo,
      baseBranch: chat.baseBranch ?? "main",
      newBranch,
      githubToken: githubToken ?? undefined,
      userId,
    })
    sandboxId = created.sandboxId
    branch = created.branch
    previewUrlPattern = created.previewUrlPattern ?? null
    createdSandbox = true
    state.sandboxId = sandboxId
    state.branch = branch
    state.previewUrlPattern = previewUrlPattern
    state.createdSandbox = true

    await prisma.chat.update({
      where: { id: chatId },
      data: {
        sandboxId,
        branch,
        previewUrlPattern,
        status: "ready",
      },
    })
  }

  // ── Stage 2: get sandbox object ────────────────────────────────────────
  let sandbox: DaytonaSandbox
  try {
    sandbox = await daytona.get(sandboxId)
  } catch {
    // Sandbox was deleted (e.g., cleanup cronjob). Attempt transparent recreation.

    // Cannot recreate NEW_REPOSITORY chats - no remote to clone from
    if (chat.repo === NEW_REPOSITORY || chat.repo === "__new__") {
      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. Cannot recreate sandbox for local repository." },
        { status: 410 }
      )
    }

    // Cannot recreate without GitHub token
    if (!githubToken) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
        { status: 410 }
      )
    }

    // Cannot recreate without existing branch name
    if (!chat.branch) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. No branch to restore." },
        { status: 410 }
      )
    }

    console.log(`[chats/messages] Sandbox ${sandboxId} not found, attempting recreation for chat ${chatId}`)

    try {
      await prisma.chat.update({
        where: { id: chatId },
        data: { status: "creating" },
      })

      const recreated = await createSandboxForChat({
        daytona,
        repo: chat.repo,
        baseBranch: chat.baseBranch ?? "main",
        newBranch: chat.branch,
        githubToken,
        userId,
        restoreExistingBranch: true,
      })

      sandboxId = recreated.sandboxId
      branch = recreated.branch
      previewUrlPattern = recreated.previewUrlPattern ?? null
      createdSandbox = true // Important: mark as created for cleanup on downstream failures
      state.sandboxId = sandboxId
      state.branch = branch
      state.previewUrlPattern = previewUrlPattern
      state.createdSandbox = true

      // The recreated sandbox is a fresh clone with no agent conversation
      // history on disk (it only ever lived in the now-deleted sandbox).
      // Drop the stale session pointer so the agent starts a new conversation
      // instead of resuming a session the CLI can't find. Clear it both in the
      // DB (for future requests) and in memory (so this request's resume read
      // below sees no session). Agent-agnostic: sessionId is the generic
      // resume pointer used by every agent.
      await prisma.chat.update({
        where: { id: chatId },
        data: {
          sandboxId,
          previewUrlPattern,
          sessionId: null,
          status: "ready",
        },
      })
      chat.sessionId = null

      sandbox = recreated.sandbox

      console.log(`[chats/messages] Successfully recreated sandbox ${sandboxId} for chat ${chatId}, branchRestored=${recreated.branchRestored}`)
    } catch (recreationError) {
      console.error(`[chats/messages] Failed to recreate sandbox for chat ${chatId}:`, recreationError)

      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found and recreation failed." },
        { status: 410 }
      )
    }
  }

  await ensureSandboxStarted(sandbox)

  // ── Stage 2a: restore repo-scoped skills ──────────────────────────────
  // On newly created sandboxes (including recreation after deletion),
  // install all skills associated with this user+repo so the agent has
  // them available from the first prompt.
  if (createdSandbox && chat.repo !== NEW_REPOSITORY) {
    await installSkillsForRepo(sandbox, userId, chat.repo)
  }

  return { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox }
}
