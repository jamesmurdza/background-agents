import { Daytona } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
import { createSandboxGit } from "@background-agents/daytona-git"

import { prisma } from "@/lib/db/prisma"
import { PATHS } from "@/lib/constants"
import { finalizeTurn, type AgentSnapshot } from "@/lib/agent-session"
import { createGitOperationMessage } from "@/lib/db/git-messages"
import { meterAssistantTurn } from "@/lib/server/token-metering"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"

import { getUserPushOptions } from "@/lib/git/push-options"
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

      // 3. Auto-push if chat has a branch (reuse existing logic from SSE stream)
      if (chat.branch && chat.repo && chat.repo !== "__new__") {
        const account = await prisma.account.findFirst({
          where: { userId: chat.userId, provider: "github" },
          select: { access_token: true },
        })

        if (account?.access_token) {
          const git = createSandboxGit(sandbox)
          const pushOptions = await getUserPushOptions(chat.userId)
          try {
            await git.push(`${PATHS.SANDBOX_HOME}/project`, account.access_token, pushOptions)
          } catch (err) {
            // Create error message with force-push action (same as SSE stream)
            await createGitOperationMessage(
              chat.id,
              `Push failed: ${err instanceof Error ? err.message : "Unknown error"}. You can force push to overwrite the remote history.`,
              true,
              { action: "force-push" }
            )
          }
        }
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
