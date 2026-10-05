import { Daytona } from "@daytonaio/sdk"

import { prisma } from "@/lib/db/prisma"
import { stripNullBytes } from "@/lib/db/pg-sanitize"
import { PATHS } from "@/lib/constants"
import { cancelBackgroundAgent, snapshotBackgroundAgent, finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { meterTurnNow } from "./meter-turn"

import { autoPushChat } from "@/lib/git/auto-push"
import { refreshUncommittedFilesWarning } from "@/lib/server/uncommitted-files-warning"
import type { ChatWithMessages } from "./types"
import { abandonFinalization, claimTurnFinalization, releaseTurn, type ActiveTurn } from "@/lib/server/turn-ownership"
import { persistAgentSnapshot } from "@/app/api/agent/stream/_lib/persist-snapshot"
import { readTurnFailure, recordTurnFailure } from "@/lib/server/turn-failure"
import { stopInteractiveAgent } from "./monitor"

// =============================================================================
// Interactive Chat Finalization
// =============================================================================

/**
 * What markChatError needs to bill a turn before tearing it down. Narrower than
 * ChatWithMessages on purpose, so callers holding any chat-shaped row can pass
 * it without loading the messages relation.
 */
type DyingChat = {
  id: string
  userId: string
  agent: string
  sandboxId: string | null
  /** The persisted agent-session resume pointer, used as a fallback id. */
  sessionId: string | null
  backgroundSessionId: string | null
  activeAssistantMessageId: string | null
}

function activeTurn(chat: DyingChat): ActiveTurn | null {
  return chat.backgroundSessionId && chat.activeAssistantMessageId
    ? { chatId: chat.id, backgroundSessionId: chat.backgroundSessionId, assistantMessageId: chat.activeAssistantMessageId }
    : null
}

export async function finalizeInteractiveChat(
  chat: ChatWithMessages,
  snapshot: AgentSnapshot,
  daytona: Daytona
) {
  const turn = activeTurn(chat)
  if (!turn) return false
  const claimId = await claimTurnFinalization(turn)
  if (!claimId) return false
  let released = false
  try {
  const failure = await readTurnFailure(turn)
  if (failure) {
    released = await markChatError(chat, failure.reason, daytona, snapshot, claimId)
    return released
  }
  // 1. Save under the finalization claim before detaching the execution.
  // A failed write must remain retryable by the next cron/stream observer.
  const assistantMessage = chat.messages.find((message) => message.id === turn.assistantMessageId)
  const saved = await persistAgentSnapshot({ prisma, turn, snapshot, finalizationClaimId: claimId })
  if (!saved.persisted) {
    return false
  }
  // 2. Finalize the turn
  if (chat.sandboxId && chat.backgroundSessionId) {
    try {
      const sandbox = await daytona.get(chat.sandboxId)
      await finalizeTurn(sandbox, chat.backgroundSessionId, {
        repoPath: `${PATHS.SANDBOX_HOME}/project`,
      })

      // 2b. Meter token/cost usage for this turn via tokscale (best-effort).
      // Runs while the sandbox is still alive; attribution (pool/provider) is
      // read from the assistant message stamped at send time.
      await meterAssistantTurn(sandbox, {
        userId: chat.userId,
        chatId: chat.id,
        messageId: assistantMessage?.id ?? null,
        messageMetadata: assistantMessage?.metadata,
        agent: chat.agent,
        sessionId: snapshot.sessionId,
      })

      // 3. Auto-push before the status reset below releases the chat. Same
      //    backend routine the SSE stream calls — conflict guard, deduped
      //    failure message, stale-failure cleanup all live in autoPushChat.
      if (chat.branch && chat.repo && chat.repo !== "__new__") {
        await autoPushChat({
          sandbox,
          repoPath: `${PATHS.SANDBOX_HOME}/project`,
          chatId: chat.id,
          userId: chat.userId,
          branch: chat.branch,
        })
        await refreshUncommittedFilesWarning({
          sandbox,
          repoPath: `${PATHS.SANDBOX_HOME}/project`,
          chatId: chat.id,
          backgroundSessionId: chat.backgroundSessionId,
        })
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to finalize chat ${chat.id}:`, err)
    }
  }

  // 4. Update chat status
  released = await releaseTurn(turn, claimId, "ready", snapshot.sessionId)
  return released
  } finally {
    if (!released) await abandonFinalization(turn, claimId)
  }
}

export async function markChatError(
  chat: DyingChat,
  reason: string,
  daytona: Daytona | undefined,
  /**
   * Preserve the failed turn's output and CLI session id before releasing it.
   * The Daytona backgroundSessionId is not the CLI's billing/resume id.
   */
  snapshot: AgentSnapshot,
  existingClaimId?: string,
) {
  const turn = activeTurn(chat)
  if (!turn || !daytona || !chat.sandboxId) return false
  const claimId = existingClaimId ?? await claimTurnFinalization(turn)
  if (!claimId) return false
  let released = false
  try {
  reason = stripNullBytes((await readTurnFailure(turn))?.reason ?? reason)
  if (!await recordTurnFailure(turn, claimId, reason, false)) return false
  {
    const sandbox = await daytona.get(chat.sandboxId)
    const options = { repoPath: `${PATHS.SANDBOX_HOME}/project` }
    await cancelBackgroundAgent(sandbox, turn.backgroundSessionId, options, true)
    const after = await snapshotBackgroundAgent(sandbox, turn.backgroundSessionId, options)
    if (after.transientReadFailure || after.status === "running") throw new Error("Cannot confirm failed agent output")
    snapshot = after
  }
  if (!(await persistAgentSnapshot({ prisma, turn, snapshot, finalizationClaimId: claimId })).persisted) {
    return false
  }
  if (!await recordTurnFailure(turn, claimId, reason, true)) return false
  // Bill what the turn already spent BEFORE the update below clears
  // backgroundSessionId. A failed turn is not a free turn: the model produced
  // tokens right up to the moment it errored or was stopped, and once the
  // session id is gone there is no cursor left to diff them against. See
  // meter-turn.
  await meterTurnNow({
    userId: chat.userId,
    chatId: chat.id,
    agent: chat.agent,
    sandboxId: chat.sandboxId,
    agentSessionId: snapshot.sessionId,
    fallbackSessionId: chat.sessionId,
    daytona,
  })

  // Keep the old turn's error row in place before it becomes possible to
  // start a new turn. Otherwise a quick retry can put this message after the
  // next user's prompt and make the transcript look like a shifted answer.
  // Retrying after a release failure must not append another error bubble.
  const errorMessageId = `${turn.assistantMessageId}:error`
  await prisma.message.upsert({
    where: { id: errorMessageId },
    create: {
      id: errorMessageId,
      chatId: chat.id,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
    update: {},
  })
  released = await releaseTurn(turn, claimId, "error", snapshot.sessionId)
  return released
  } finally {
    // A failed write/release leaves the execution pointer available for retry.
    if (!released) await abandonFinalization(turn, claimId)
  }
}

/** Own the timeout/credit decision before touching the process. */
export async function stopInteractiveChat(chat: ChatWithMessages, reason: string, daytona: Daytona) {
  const turn = activeTurn(chat)
  if (!turn || !chat.sandboxId) return false
  const claimId = await claimTurnFinalization(turn)
  if (!claimId) return false
  try {
    const stopped = await stopInteractiveAgent(chat.sandboxId, turn.backgroundSessionId, daytona, async () => {
      if (!await recordTurnFailure(turn, claimId, reason, false)) throw new Error("Turn changed before cancellation")
    })
    if (!stopped.cancelled && stopped.snapshot.status === "completed") {
      await abandonFinalization(turn, claimId)
      return finalizeInteractiveChat(chat, stopped.snapshot, daytona)
    }
    return await markChatError(chat, reason, daytona, stopped.snapshot, claimId)
  } finally {
    // Conditional abandonment is harmless after a successful release.
    await abandonFinalization(turn, claimId)
  }
}
