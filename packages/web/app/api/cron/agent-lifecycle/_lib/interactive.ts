import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import { meterDyingTurn } from "./meter-dying-turn"

import { autoPushChat } from "@/lib/git/auto-push"
import type { ChatWithMessages } from "./types"

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
}

export async function finalizeInteractiveChat(
  chat: ChatWithMessages,
  snapshot: AgentSnapshot,
  daytona: Daytona
) {
  // 1. Update message content (same as SSE stream does). Best-effort and
  //    NUL-sanitized: a failing message write must NOT prevent the status reset
  //    in step 4 below, or the chat is stranded as permanently "running".
  const assistantMessage = chat.messages[0]

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
      }
    } catch (err) {
      console.error(`[agent-lifecycle] Failed to finalize chat ${chat.id}:`, err)
    }
  }

  // 4. Update chat status
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "ready",
      backgroundSessionId: null,
      sessionId: snapshot.sessionId || undefined,
      lastActiveAt: new Date(),
    },
  })
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
  // Bill what the turn already spent BEFORE the update below clears
  // backgroundSessionId. A failed turn is not a free turn: the model produced
  // tokens right up to the moment it errored or was stopped, and once the
  // session id is gone there is no cursor left to diff them against. See
  // meter-dying-turn.
  await meterDyingTurn({
    userId: chat.userId,
    chatId: chat.id,
    agent: chat.agent,
    sandboxId: chat.sandboxId,
    agentSessionId,
    fallbackSessionId: chat.sessionId,
    daytona,
  })

  // Update chat status
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "error",
      backgroundSessionId: null,
    },
  })

  // Create error message
  await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
  })
}
