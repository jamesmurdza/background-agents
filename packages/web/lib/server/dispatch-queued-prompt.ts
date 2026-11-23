import { sendChatTurn } from "@/app/api/chats/[chatId]/messages/_lib/send-turn"
import { SECRETS_UNAVAILABLE_CODE, TURN_SECRETS_UNAVAILABLE_MESSAGE } from "@/lib/secrets-failure"
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
        reasoningEffort: claimed.reasoningEffort ?? undefined,
        userMessageId: claimed.userMessageId,
        assistantMessageId: claimed.assistantMessageId,
      },
      files: [],
      claimedPromptId: claimed.id,
    })
    if (response.ok) return "started"

    const body = await response.json().catch(() => null) as { code?: string; error?: string } | null
    const fallback = `Couldn't start queued prompt (HTTP ${response.status})`
    const safeReason = response.status === 503 && body?.code === SECRETS_UNAVAILABLE_CODE
      ? TURN_SECRETS_UNAVAILABLE_MESSAGE
      : response.status >= 500 ? fallback : body?.error || fallback
    await releaseFailedPrompt(claimed.id, safeReason)
    return "paused"
  } catch (error) {
    console.error(`[prompt-queue] Dispatch failed for chat ${chatId}:`, error)
    await releaseFailedPrompt(claimed.id, "Couldn't start queued prompt")
    return "error"
  }
}
