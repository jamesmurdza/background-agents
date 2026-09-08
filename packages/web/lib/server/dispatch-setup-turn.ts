/**
 * Transitions a chat out of `setting_up` and starts its queued agent turn.
 *
 * Two callers can observe the same job exit: the /setup SSE endpoint and the
 * agent-lifecycle cron. The transition is therefore an updateMany guarded on
 * the current status, and only the caller that actually changed a row goes on
 * to launch the turn. Without that guard, a watched setup would run the user's
 * message twice.
 *
 * The claim deliberately does NOT move the chat to `ready`. Turn startup is
 * slow (history, MCP, skill discovery, session creation), and a chat parked at
 * `ready` mid-startup is invisible to every recovery path there is: the cron's
 * interactive monitor wants `running` plus a backgroundSessionId, its setup
 * phase wants `setting_up`, and /api/agent/stop returns early with no
 * backgroundSessionId. An invocation killed in that window would strand the
 * chat with a persisted message, no reply, and no way out. So the claim only
 * stamps `claimedAt`, the chat stays `setting_up` (and stays 409-busy to a
 * second tab), and `persistTurn` moves it to `running` when the turn really
 * starts. A claim older than {@link DISPATCH_CLAIM_TTL_MS} is assumed dead and
 * re-claimable, which is what lets the cron recover a killed dispatch.
 */


import { randomUUID } from "crypto"
import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
import { PATHS } from "@/lib/constants"
import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth } from "@/lib/db/api-helpers"
import { ensureSandboxStarted } from "@/lib/sandbox"
import { getUserEndpoints } from "@/lib/server/custom-endpoints"
import { buildSetupFailureNote, type SetupRunRecord } from "@/lib/setup-script"
import { resolveSendCredentials } from "@/app/api/chats/[chatId]/messages/_lib/resolve-credentials"
import type { MessagePayload } from "@/app/api/chats/[chatId]/messages/_lib/types"
import { runQueuedTurnForChat } from "./run-queued-turn"
/** How long a dispatch claim is respected before another observer may retry.
 *  Comfortably longer than turn startup, shorter than a user's patience. */
export const DISPATCH_CLAIM_TTL_MS = 5 * 60 * 1000

/**
 * Thrown when the chat's last user message already has a reply, so there is no
 * queued turn to run.
 *
 * Reachable on a recreated sandbox: recreation goes back through the setup
 * path, so an invocation killed between the `setting_up` write and
 * `persistQueuedUserMessage` leaves a chat whose newest message is the previous
 * turn's answer. Dispatching that would silently re-run an answered message.
 */
export class AlreadyAnsweredError extends Error {
  constructor() {
    super("Latest user message already has an answer")
    this.name = "AlreadyAnsweredError"
  }
}

/**
 * The claim guard. Exported so it can be exercised against a real database:
 * whether an absent `claimedAt` key matches `Prisma.DbNull` on a JSON path is
 * database behavior, not something a mocked client can tell you.
 */
export function buildClaimWhere(chatId: string, now: number) {
  return {
    id: chatId,
    status: "setting_up",
    OR: [
      // Never claimed. An absent `claimedAt` key reads as SQL NULL, which is
      // what Prisma's DbNull matches on a JSON path.
      { setupRun: { path: ["claimedAt"], equals: Prisma.DbNull } },
      // Claimed, but by an invocation that never finished.
      { setupRun: { path: ["claimedAt"], lt: now - DISPATCH_CLAIM_TTL_MS } },
    ],
  }
}

export async function dispatchQueuedTurn(args: {
  chatId: string
  userId: string
  setupRun: SetupRunRecord
  logTail: string
}): Promise<boolean> {
  const { chatId, userId, setupRun, logTail } = args

  const now = Date.now()
  const claimed = await prisma.chat.updateMany({
    where: buildClaimWhere(chatId, now),
    data: {
      setupRun: { ...setupRun, claimedAt: now } as never,
    },
  })

  // Someone else already claimed this exit and is running the turn.
  if (claimed.count === 0) return false

  const failed = setupRun.state !== "exited" || (setupRun.exitCode ?? 1) !== 0

  // Setup never hard-blocks. On failure the agent runs anyway, told what
  // happened, because a missing dependency is often something it can fix,
  // including by editing the setup script, which then syncs back.
  const note = failed ? buildSetupFailureNote(setupRun.exitCode ?? null, logTail) : null

  try {
    await startQueuedTurn(chatId, userId, note)
  } catch (err) {
    // Nothing failed: there was simply no unanswered turn to dispatch. Move
    // the chat to `ready` so it stops being 409-busy and stops being
    // re-claimed every tick.
    if (err instanceof AlreadyAnsweredError) {
      console.warn(`[dispatch-setup-turn] chat ${chatId}: no queued turn to dispatch`)
      await prisma.chat
        .update({ where: { id: chatId }, data: { status: "ready" } })
        .catch(() => {})
      return true
    }
    // Move the chat off `setting_up` so it stops being 409-busy and stops
    // being re-claimed every tick: this failure is not transient enough to
    // retry blindly. Never log `logTail`: it is unredacted script output.
    console.error(`[dispatch-setup-turn] chat ${chatId} failed to start:`, err)
    await prisma.chat
      .update({ where: { id: chatId }, data: { status: "error" } })
      .catch(() => {})
  }

  return true
}

/**
 * Runs the chat's most recent unanswered user message through the normal turn
 * path, optionally prefixed with a setup-failure note.
 *
 * This is the cold caller: the request that queued the turn is long gone, so
 * everything `runQueuedTurnForChat` needs is rebuilt from the database and from
 * Daytona. Two values cannot be rebuilt exactly and are documented where they
 * are chosen: the assistant message id (the client's optimistic id was never
 * persisted) and per-send plan mode (only the chat-level default is stored).
 */
async function startQueuedTurn(
  chatId: string,
  userId: string,
  setupFailureNote: string | null
): Promise<void> {
  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) throw new Error("Chat not found")
  if (!chat.sandboxId) throw new Error("Chat has no sandbox")

  // The newest user-or-assistant row, not the newest *user* row: a queued turn
  // is always the last thing written (no assistant placeholder is persisted for
  // it), so an assistant row on top means the last user message was already
  // answered and there is nothing to dispatch. Roles other than these two are
  // ignored so a non-conversational row could never mask the answer.
  const latest = await prisma.message.findFirst({
    where: { chatId, role: { in: ["user", "assistant"] } },
    orderBy: { timestamp: "desc" },
  })
  if (!latest) throw new Error("No queued user message to dispatch")
  if (latest.role !== "user") throw new AlreadyAnsweredError()
  const userMessage = latest

  const payload: MessagePayload = {
    // Already the fully built prompt: the pull-conflict note and the uploaded
    // files section were baked in before it was persisted. Pass it straight
    // through as `agentPrompt` rather than rebuilding either.
    message: userMessage.content,
    agent: userMessage.agent ?? chat.agent,
    model: userMessage.model ?? chat.model ?? "",
    userMessageId: userMessage.id,
    // The client's optimistic assistant id was deliberately not persisted (an
    // assistant row would have made `buildAgentHistory` read this chat as
    // having already answered). A fresh id is correct; the client reloads the
    // thread when the setup stream finishes.
    assistantMessageId: randomUUID(),
    // Per-send plan mode is not persisted anywhere, so fall back to the chat's
    // own setting. A turn held by setup is a chat's first turn, where the two
    // agree unless the user toggled the composer for that one send.
    planMode: chat.planModeEnabled,
  }

  const resolved = await resolveSendCredentials(userId, payload)
  // A 429 (daily budget spent) or 503 (shared credentials unavailable) at
  // dispatch time. There is no request left to return it to, so fail the turn
  // rather than letting a Response object fall through as an "error".
  if (resolved instanceof Response) {
    throw new Error(`Credentials unavailable at dispatch (HTTP ${resolved.status})`)
  }
  const { credentials, useSharedClaude } = resolved

  const customEndpoints = await getUserEndpoints(userId)

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) throw new Error("DAYTONA_API_KEY not configured")
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(chat.sandboxId)
  // Every normal turn reaches the agent through ensureSandboxForChat, which
  // ends in this call. A held turn skipped that path, and with
  // autoStopInterval at 5 minutes a sandbox whose polling lapsed is stopped by
  // the time we get here, so createBackgroundAgentSession would throw.
  await ensureSandboxStarted(sandbox)

  const uploadedFilePaths = Array.isArray(userMessage.uploadedFiles)
    ? (userMessage.uploadedFiles as unknown[]).filter(
        (p): p is string => typeof p === "string"
      )
    : []

  await runQueuedTurnForChat({
    sandbox,
    chat,
    chatId,
    userId,
    payload,
    credentials,
    customEndpoints,
    repoPath: `${PATHS.SANDBOX_HOME}/project`,
    previewUrlPattern: chat.previewUrlPattern,
    agentPrompt: userMessage.content,
    uploadedFilePaths,
    useSharedClaude,
    setupFailureNote,
  })
}

/** Stamp an observed job exit onto the stored record. */
export function finishSetupRecord(
  record: SetupRunRecord,
  status: { state: string; exitCode: number | null }
): SetupRunRecord {
  return {
    ...record,
    state: status.state === "exited" ? "exited" : "crashed",
    exitCode: status.exitCode,
    finishedAt: Date.now(),
  }
}
