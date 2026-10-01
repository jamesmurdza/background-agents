import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import { meterTurnNow } from "./meter-turn"

import { autoPushChat } from "@/lib/git/auto-push"
import { refreshUncommittedFilesWarning } from "@/lib/server/uncommitted-files-warning"
import type { ChatWithMessages } from "./types"
import { claimTurnFinalization, releaseTurn, type ActiveTurn } from "@/lib/server/turn-ownership"

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
  try {
  // 1. Update message content (same as SSE stream does). Best-effort and
  //    NUL-sanitized: a failing message write must NOT prevent the status reset
  //    in step 4 below, or the chat is stranded as permanently "running".
  const assistantMessage = chat.messages.find((message) => message.id === turn.assistantMessageId)

  if (assistantMessage) {
    try {
      await prisma.message.update({
        where: { id: assistantMessage.id },
        data: {
          content: stripNullBytes(snapshot.content),
          toolCalls:
            snapshot.toolCalls.length > 0
              ? (stripNullBytesDeep(snapshot.toolCalls) as unknown as Prisma.InputJsonValue)
              : undefined,
          contentBlocks:
            snapshot.contentBlocks.length > 0
              ? (stripNullBytesDeep(snapshot.contentBlocks) as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      })
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to persist message for chat ${chat.id}:`, err)
    }
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
  return true
  } finally {
    await releaseTurn(turn, claimId, "ready", snapshot.sessionId)
  }
}

export async function markChatError(
  chat: DyingChat,
  reason: string,
  daytona?: Daytona,
  /**
   * The agent CLI's session id, from whichever snapshot saw the failure. The
   * chat row cannot supply it: Chat.backgroundSessionId is the Daytona handle,
   * a different namespace entirely. Without this the turn cannot be billed.
   */
  agentSessionId?: string
) {
  const turn = activeTurn(chat)
  if (!turn) return
  const claimId = await claimTurnFinalization(turn)
  if (!claimId) return
  try {
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
    agentSessionId,
    fallbackSessionId: chat.sessionId,
    daytona,
  })

  // Keep the old turn's error row in place before it becomes possible to
  // start a new turn. Otherwise a quick retry can put this message after the
  // next user's prompt and make the transcript look like a shifted answer.
  await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
  })

  } finally {
    // Metering or message persistence can fail. Never strand the chat.
    await releaseTurn(turn, claimId, "error")
  }
}
