import { prisma } from "@/lib/db/prisma"
import { NEW_REPOSITORY } from "@/lib/types"

// =============================================================================
// Shared-chat data loading + sanitization
// =============================================================================
//
// Used by both the public API route (/api/share/[shareId]) and the public page
// (/share/[shareId]). The payload is deliberately minimal: only what's needed
// to render the conversation read-only. Sandbox/session ids, env vars, branch,
// and tool-call `filePath`s are stripped so nothing private or sandbox-local
// leaks to viewers.

export interface SharedMessage {
  id: string
  role: string
  content: string
  timestamp: number
  messageType: string | null
  isError: boolean
  toolCalls: unknown
  contentBlocks: unknown
  uploadedFiles: unknown
  linkBranch: string | null
  metadata: unknown
  agent: string | null
  model: string | null
}

export interface SharedChat {
  displayName: string | null
  /** "owner/repo" for a real repo, or null for a local/private repo. */
  repo: string | null
  messages: SharedMessage[]
}

/** Drop `filePath` from a single tool call so absolute sandbox paths never
 *  reach the public payload (the renderer also won't link them). */
function sanitizeToolCall(tc: unknown): Record<string, unknown> | null {
  if (!tc || typeof tc !== "object") return null
  const { filePath: _filePath, ...rest } = tc as Record<string, unknown>
  return rest
}

function sanitizeToolCalls(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map(sanitizeToolCall).filter(Boolean)
}

/** Strip `filePath` from tool calls nested inside content blocks. */
function sanitizeContentBlocks(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((block) => {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "tool_calls"
    ) {
      const b = block as Record<string, unknown>
      return { ...b, toolCalls: sanitizeToolCalls(b.toolCalls) }
    }
    return block
  })
}

/** Load a publicly-shared chat by its share token, sanitized for public view.
 *  Returns null if no chat has that token. */
export async function getSharedChat(shareId: string): Promise<SharedChat | null> {
  const chat = await prisma.chat.findUnique({
    where: { shareId },
    select: { id: true, displayName: true, repo: true },
  })
  if (!chat) return null

  const messages = await prisma.message.findMany({
    where: { chatId: chat.id },
    orderBy: { timestamp: "asc" },
  })

  return {
    displayName: chat.displayName,
    repo: chat.repo === NEW_REPOSITORY ? null : chat.repo,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: Number(m.timestamp),
      messageType: m.messageType,
      isError: m.isError,
      toolCalls: sanitizeToolCalls(m.toolCalls),
      contentBlocks: sanitizeContentBlocks(m.contentBlocks),
      uploadedFiles: m.uploadedFiles,
      linkBranch: m.linkBranch,
      metadata: m.metadata,
      agent: m.agent,
      model: m.model,
    })),
  }
}
