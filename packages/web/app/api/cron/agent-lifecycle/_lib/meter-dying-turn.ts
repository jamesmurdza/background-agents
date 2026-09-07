import { Daytona } from "@daytonaio/sdk"

import { prisma } from "@/lib/db/prisma"
import { meterAssistantTurn } from "@/lib/server/token-metering"

// =============================================================================
// Metering a turn that is about to be torn down
// =============================================================================
// The happy paths (finalizeInteractiveChat, finalizeScheduledRun) meter before
// they release the chat, and so does the SSE stream route — which meters an
// "error" snapshot exactly like a "completed" one, because a turn that failed
// still burned whatever the model produced before it failed.
//
// The cron's failure paths did not. They went straight to markChatError /
// failScheduledRun, which clear `backgroundSessionId` (and, for a scheduled
// run, delete the sandbox outright). Both of those destroy the only handles
// metering has: without the session id there is no cursor to diff against, and
// without the sandbox there is no tokscale to ask. So the tokens a crashed,
// rate-limited or timed-out turn had already spent were never billed and could
// never be recovered afterwards.
//
// This is the missing counterpart. Call it before the teardown, never after.
//
// The id it needs is the AGENT CLI's session id — what tokscale files usage
// under, and what every other metering call site passes as `snapshot.sessionId`.
// It is NOT `Chat.backgroundSessionId`, which is the Daytona handle used to
// talk to the sandbox: the two never coincide (checked against production —
// no TokenUsage row has ever matched a backgroundSessionId), so passing the
// wrong one silently meters nothing at all.
//
// Best-effort by construction: a failing turn is already a bad day, and a
// metering error must not stop the chat being released from "running" — that
// would strand it far more visibly than an unbilled turn. Every failure is
// logged and swallowed.

/**
 * Meter whatever a dying turn already spent, while the sandbox and session id
 * are still around to be asked. Returns the number of usage rows written (0
 * when there was nothing to meter, or when anything at all went wrong).
 */
export async function meterDyingTurn(params: {
  userId: string
  chatId: string
  agent: string
  sandboxId: string | null
  /**
   * The agent CLI's session id, from the snapshot that observed the failure.
   * Not the Daytona backgroundSessionId — see above.
   */
  agentSessionId: string | null | undefined
  /**
   * `Chat.sessionId`, the persisted resume pointer. Used when the snapshot
   * could not be read: a resumed turn continues that very session, so the CLI
   * reports usage under it. Null on a chat's first turn, where only the
   * snapshot knows the id — hence the ordering.
   */
  fallbackSessionId?: string | null
  daytona?: Daytona
}): Promise<number> {
  const { userId, chatId, agent, sandboxId, daytona } = params
  const sessionId = params.agentSessionId || params.fallbackSessionId

  // No sandbox to run tokscale in, or no session to attribute usage to —
  // nothing to do. Not an error: a run can fail before either exists.
  if (!sandboxId || !sessionId || !daytona) return 0

  try {
    // The turn's own assistant message, for attribution: its metadata carries
    // the pool/provider/key stamped at send time. It may be missing (the turn
    // died before one was written), which meterAssistantTurn tolerates — the
    // usage is still recorded against the chat, just without a message label.
    const assistantMessage = await prisma.message.findFirst({
      where: { chatId, role: "assistant" },
      orderBy: { timestamp: "desc" },
      select: { id: true, metadata: true },
    })

    const sandbox = await daytona.get(sandboxId)
    return await meterAssistantTurn(sandbox, {
      userId,
      chatId,
      messageId: assistantMessage?.id ?? null,
      messageMetadata: assistantMessage?.metadata,
      agent,
      sessionId,
    })
  } catch (err) {
    console.error(
      `[agent-lifecycle] Failed to meter the dying turn for chat ${chatId}:`,
      err
    )
    return 0
  }
}
