import { prisma } from "@/lib/db/prisma"
import { claimNextPrompt, recoverStaleClaims, releaseFailedPrompt } from "@/lib/server/prompt-queue"
import { sendChatTurn } from "@/app/api/chats/[chatId]/messages/_lib/send-turn"

export const maxDuration = 300

/**
 * Runs independently of browser tabs. A persisted queue is useful only if a
 * server worker can start the next turn after the previous one is finalized.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if ((process.env.NODE_ENV === "production" && !secret) ||
      (secret && req.headers.get("authorization") !== `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const results = { recovered: 0, started: 0, paused: 0, errors: 0 }
  try {
    // maxDuration is five minutes. A claim older than seven minutes could not
    // still belong to a live invocation; reconcile before taking new work.
    results.recovered = await recoverStaleClaims(new Date(Date.now() - 7 * 60_000))
    const chats = await prisma.chat.findMany({
      where: {
        status: "ready",
        backgroundSessionId: null,
        queuePaused: false,
        scheduledJobRun: null,
        queuedPrompts: { some: { status: "queued" } },
      },
      select: { id: true, userId: true },
      orderBy: { lastActiveAt: "asc" },
      take: 3,
    })

    await Promise.all(chats.map(async (chat) => {
      let claimed: Awaited<ReturnType<typeof claimNextPrompt>> = null
      try {
        claimed = await claimNextPrompt(chat.id)
        if (!claimed) return
        const response = await sendChatTurn({
          userId: chat.userId,
          chatId: chat.id,
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
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string }
          const safeReason = response.status >= 500
            ? `Couldn't start queued prompt (HTTP ${response.status})`
            : body.error || `Couldn't start queued prompt (HTTP ${response.status})`
          await releaseFailedPrompt(claimed.id, safeReason)
          results.paused++
          return
        }
        results.started++
      } catch (error) {
        console.error(`[prompt-queue] Dispatch failed for chat ${chat.id}:`, error)
        if (claimed) await releaseFailedPrompt(claimed.id, "Couldn't start queued prompt")
        results.errors++
      }
    }))
  } catch (error) {
    console.error("[prompt-queue] Worker failed:", error)
    results.errors++
  }
  return Response.json(results)
}
