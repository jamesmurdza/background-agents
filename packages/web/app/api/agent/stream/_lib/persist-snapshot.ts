import { Prisma, type PrismaClient } from "@prisma/client"
import type { AgentSnapshot } from "@/lib/agent-session"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"

/**
 * Minimal slice of PrismaClient this module needs. Declared structurally so the
 * unit test can pass a mock without standing up a real client.
 */
export interface SnapshotPersistClient {
  message: { update: (args: Prisma.MessageUpdateArgs) => Promise<unknown> }
  chat: { update: (args: Prisma.ChatUpdateArgs) => Promise<unknown> }
}

/**
 * Persist an agent snapshot to the DB during/after a streamed turn.
 *
 * IMPORTANT INVARIANT: when `isFinal` is true, the chat MUST be released from
 * its "running" state (status -> ready/error, backgroundSessionId -> null) even
 * if persisting the message body fails.
 *
 * The two writes are therefore independent. Previously they shared one
 * try/catch with the message write first, so a failing message write (e.g. a
 * stray NUL byte in agent output, which Postgres rejects) silently skipped the
 * status reset and left the chat stuck "running" forever — the UI kept showing
 * "Agent is working…" on every refresh and every send was rejected with
 * "Chat is busy". Content is also NUL-sanitized so the message write itself
 * stops failing and the agent's final output isn't lost.
 *
 * Returns whether the final status reset was committed, so callers can log /
 * react. Errors are swallowed (logged) — a streamed turn must never 500 on a
 * persistence hiccup.
 */
export async function persistAgentSnapshot(params: {
  prisma: SnapshotPersistClient
  chatId: string
  assistantMessageId: string
  snapshot: AgentSnapshot
  isFinal: boolean
}): Promise<{ statusReset: boolean }> {
  const { prisma, chatId, assistantMessageId, snapshot, isFinal } = params

  // 1. Persist the message body (best-effort, NUL-sanitized).
  try {
    await prisma.message.update({
      where: { id: assistantMessageId },
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
  } catch (error) {
    console.error("[agent/stream] message persist error:", error)
  }

  // 2. On the final write, release the chat from "running" — independently of
  //    whether the message write above succeeded. This is the safety-critical
  //    half: skipping it strands the chat as permanently busy.
  if (!isFinal) return { statusReset: false }

  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        lastActiveAt: new Date(),
        status: snapshot.status === "error" ? "error" : "ready",
        backgroundSessionId: null,
        sessionId: snapshot.sessionId || undefined,
      },
    })
    return { statusReset: true }
  } catch (error) {
    console.error("[agent/stream] chat finalize error:", error)
    return { statusReset: false }
  }
}

// Re-exported only so the route keeps a single import site if it ever needs the
// concrete client type.
export type { PrismaClient }
