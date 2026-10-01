import { prisma } from "@/lib/db/prisma"
import { recoverStaleClaims } from "@/lib/server/prompt-queue"
import { dispatchQueuedPrompt } from "@/lib/server/dispatch-queued-prompt"

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
      try {
        const status = await dispatchQueuedPrompt(chat.id, chat.userId)
        if (status === "started") results.started++
        if (status === "paused") results.paused++
        if (status === "error") results.errors++
      } catch (error) {
        console.error(`[prompt-queue] Dispatch failed for chat ${chat.id}:`, error)
        results.errors++
      }
    }))
  } catch (error) {
    console.error("[prompt-queue] Worker failed:", error)
    results.errors++
  }
  return Response.json(results)
}
