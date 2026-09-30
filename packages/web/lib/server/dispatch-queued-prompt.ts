import { sendChatTurn } from "@/app/api/chats/[chatId]/messages/_lib/send-turn"
import { claimNextPrompt, releaseFailedPrompt } from "@/lib/server/prompt-queue"

export type QueueDispatchStatus = "started" | "skipped" | "paused" | "error"

/** Used by both browser wake-ups and the cron. The database claim decides who wins. */
export async function dispatchQueuedPrompt(chatId: string, userId: string): Promise<QueueDispatchStatus> {
  const claimed = await claimNextPrompt(chatId)
  if (!claimed) return "skipped"

  try {
    const response = await sendChatTurn({
      userId,
      chatId,
      payload: {
        message: claimed.content,
        agent: claimed.agent,
        model: claimed.model,
        userMessageId: claimed.userMessageId,
        assistantMessageId: claimed.assistantMessageId,
      },
      files: [],
      claimedPromptId: claimed.id,
    })
    if (response.ok) return "started"

    const body = await response.json().catch(() => ({})) as { error?: string }
    const safeReason = response.status >= 500
      ? `Couldn't start queued prompt (HTTP ${response.status})`
      : body.error || `Couldn't start queued prompt (HTTP ${response.status})`
    await releaseFailedPrompt(claimed.id, safeReason)
    return "paused"
  } catch (error) {
    console.error(`[prompt-queue] Dispatch failed for chat ${chatId}:`, error)
    await releaseFailedPrompt(claimed.id, "Couldn't start queued prompt")
    return "error"
  }
}
