import { prisma } from "@/lib/db/prisma"
import type { ChatRecord, MessagePayload } from "./types"

type AgentHistory = { role: "user" | "assistant"; content: string }[]

export interface AgentHistoryResult {
  history: AgentHistory | undefined
  /** True when the incoming agent differs from the one that produced the last assistant message. */
  isAgentSwitch: boolean
}

/**
 * Decide what prior conversation (if any) to replay to the agent for this turn,
 * and whether this is an agent switch.
 *
 * Two sources, in priority order:
 *  - Agent switch: the incoming agent differs from the one that produced the
 *    most recent assistant message — replay this chat's own history so the new
 *    CLI has context. (Per-message agent fields are immutable, so this still
 *    works after the dropdown already PATCHed chat.agent.)
 *  - Chat fork: the chat was forked from a parent and has no assistant message
 *    yet — replay the parent's conversation for the first message.
 */
export async function buildAgentHistory(
  chatId: string,
  chat: ChatRecord,
  payload: MessagePayload
): Promise<AgentHistoryResult> {
  const lastAssistant = await prisma.message.findFirst({
    where: { chatId, role: "assistant" },
    orderBy: { timestamp: "desc" },
    select: { agent: true },
  })
  const isAgentSwitch =
    !!lastAssistant?.agent && lastAssistant.agent !== payload.agent

  let history: AgentHistory | undefined

  if (isAgentSwitch) {
    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { timestamp: "asc" },
      select: { role: true, content: true },
    })
    history = messages
      .filter(
        (
          m
        ): m is typeof m & { role: "user" | "assistant" } =>
          (m.role === "user" || m.role === "assistant") &&
          !!m.content.trim()
      )
      .map((m) => ({ role: m.role, content: m.content }))

    if (history.length === 0) history = undefined
    else
      console.log(
        `[chats/messages] Agent switch detected: injecting ${history.length} history messages`
      )
  }

  // When a chat is forked from a parent (via /branch, Option+Enter, etc.),
  // the first message should include the parent's conversation history so
  // the agent has context about what was previously discussed.
  if (!history && chat.parentChatId && !lastAssistant) {
    const parentMessages = await prisma.message.findMany({
      where: { chatId: chat.parentChatId },
      orderBy: { timestamp: "asc" },
      select: { role: true, content: true },
    })
    history = parentMessages
      .filter(
        (
          m
        ): m is typeof m & { role: "user" | "assistant" } =>
          (m.role === "user" || m.role === "assistant") &&
          !!m.content.trim()
      )
      .map((m) => ({ role: m.role, content: m.content }))

    if (history.length === 0) history = undefined
    else
      console.log(
        `[chats/messages] Chat fork detected: injecting ${history.length} parent messages`
      )
  }

  return { history, isAgentSwitch }
}
