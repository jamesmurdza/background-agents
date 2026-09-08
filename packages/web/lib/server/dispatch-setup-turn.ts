/**
 * Transitions a chat out of `setting_up` and starts its queued agent turn.
 *
 * Two callers can observe the same job exit: the /setup SSE endpoint and the
 * agent-lifecycle cron. The transition is therefore an updateMany guarded on
 * the current status, and only the caller that actually changed a row goes on
 * to launch the turn. Without that guard, a watched setup would run the user's
 * message twice.
 */

import { randomUUID } from "crypto"
import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { prisma } from "@/lib/db/prisma"
import { getChatWithAuth } from "@/lib/db/api-helpers"
import { getUserEndpoints } from "@/lib/server/custom-endpoints"
import { buildSetupFailureNote, type SetupRunRecord } from "@/lib/setup-script"
import { resolveSendCredentials } from "@/app/api/chats/[chatId]/messages/_lib/resolve-credentials"
import type { MessagePayload } from "@/app/api/chats/[chatId]/messages/_lib/types"
import { runQueuedTurnForChat } from "./run-queued-turn"

export async function dispatchQueuedTurn(args: {
  chatId: string
  userId: string
  setupRun: SetupRunRecord
  logTail: string
}): Promise<boolean> {
  const { chatId, userId, setupRun, logTail } = args

  const claimed = await prisma.chat.updateMany({
    where: { id: chatId, status: "setting_up" },
    data: {
      status: "ready",
      setupRun: setupRun as never,
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
    // The claim already moved the chat out of `setting_up`, so nothing will
    // retry this. Surface it rather than leaving an unanswered user message on
    // a chat that looks idle. Never log `logTail`: it is unredacted script
    // output.
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

  const userMessage = await prisma.message.findFirst({
    where: { chatId, role: "user" },
    orderBy: { timestamp: "desc" },
  })
  if (!userMessage) throw new Error("No queued user message to dispatch")

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
