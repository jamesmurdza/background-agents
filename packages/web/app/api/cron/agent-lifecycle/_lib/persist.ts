import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import type { AgentSnapshot } from "@/lib/agent-session"

/**
 * Persist an agent's finalized snapshot onto its assistant message row
 * (content + tool calls + content blocks), NUL-sanitized for Postgres. Shared
 * by the interactive and scheduled finalizers.
 *
 * Best-effort: a failed write is logged (tagged with `logContext`, e.g.
 * `chat <id>` or `run <id>`) and swallowed so the caller can still reset the
 * chat/run status — otherwise the row is stranded as permanently "running".
 */
export async function persistFinalizedAssistantMessage(
  messageId: string,
  snapshot: AgentSnapshot,
  logContext: string
): Promise<void> {
  try {
    await prisma.message.update({
      where: { id: messageId },
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
    console.error(`[agent-lifecycle] Failed to persist message for ${logContext}:`, err)
  }
}
