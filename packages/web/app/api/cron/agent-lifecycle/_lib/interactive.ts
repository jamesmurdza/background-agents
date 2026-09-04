import { Daytona } from "@daytonaio/sdk"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { persistFinalizedAssistantMessage } from "./persist"

import { autoPushChat } from "@/lib/git/auto-push"
import type { ChatWithMessages } from "./types"

// =============================================================================
// Interactive Chat Finalization
// =============================================================================

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
    await persistFinalizedAssistantMessage(assistantMessage.id, snapshot, `chat ${chat.id}`)
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

export async function markChatError(chatId: string, reason: string) {
  // Update chat status
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      status: "error",
      backgroundSessionId: null,
    },
  })

  // Create error message
  await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true,
    },
  })
}
