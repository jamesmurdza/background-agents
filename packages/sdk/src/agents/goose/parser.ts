/**
 * Goose CLI output parser
 *
 * Pure function for parsing Goose CLI stream-json output.
 * Goose outputs newline-delimited JSON events.
 *
 * Actual format discovered from running goose:
 * - {"type":"message","message":{...}} for messages
 * - {"type":"complete","total_tokens":...} for completion
 * - Content blocks use {"type":"text","text":"..."} format
 * - Tool calls use {"type":"tool_use",...} and {"type":"tool_result",...}
 */

import type { Event } from "../../types/events"
import type { ParseContext } from "../../core/agent"
import { createToolStartEvent } from "../../core/tools"
import { safeJsonParse } from "../../utils/json"
import { resolveAgentError } from "../../utils/errors"

/**
 * Content block types within a message
 */
interface GooseTextContent {
  type: "text"
  text: string
}

interface GooseToolUse {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

interface GooseToolResult {
  type: "tool_result"
  tool_use_id: string
  content?: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}

type GooseContentBlock = GooseTextContent | GooseToolUse | GooseToolResult

/**
 * Message event containing role and content
 */
interface GooseMessageEvent {
  type: "message"
  message: {
    id: string | null
    role: "assistant" | "user"
    created: number
    content: GooseContentBlock[]
    metadata?: {
      userVisible?: boolean
      agentVisible?: boolean
    }
  }
}

/**
 * Complete event marking successful completion
 */
interface GooseCompleteEvent {
  type: "complete"
  total_tokens: number | null
}

/**
 * Error event
 */
interface GooseErrorEvent {
  type: "error"
  error: string | { message: string; code?: string }
}

type GooseEvent = GooseMessageEvent | GooseCompleteEvent | GooseErrorEvent

/**
 * Goose doesn't emit a `{type:"error"}` event for provider/model failures (auth,
 * balance, quota, …). Instead it wraps them in an assistant message whose text
 * is `Ran into this error: <detail>. Please retry if you think this is a
 * transient or recoverable error.` and then emits a plain `complete`. This
 * captures `<detail>` (dropping the retry boilerplate) so `complete` can surface
 * a real error instead of looking like a clean, empty success.
 */
const GOOSE_ERROR_TEXT =
  /^\s*Ran into this error:\s*([\s\S]+?)\.?\s*(?:Please retry if you think this is a transient or recoverable error\.?)?\s*$/i

/**
 * Parse a line of Goose CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @param context - Parse context for session tracking
 * @returns Event, array of events, or null if line should be ignored
 */
export function parseGooseLine(
  line: string,
  toolMappings: Record<string, string>,
  context?: ParseContext
): Event | Event[] | null {
  // Goose outputs plain JSON, but handle SSE "data: " prefix if present
  const trimmedLine = line.startsWith("data: ") ? line.slice(6) : line

  const json = safeJsonParse<GooseEvent>(trimmedLine)
  if (!json) {
    return null
  }

  // Message event containing role and content blocks
  if (json.type === "message" && json.message) {
    const msg = json.message
    const events: Event[] = []

    // Emit session event on first assistant message with an ID
    // Goose doesn't have a dedicated session init event, so we use the message ID
    if (
      context &&
      msg.role === "assistant" &&
      msg.id &&
      !context.state.sessionEmitted
    ) {
      context.state.sessionEmitted = true
      // Use the message ID as the session ID (or generate one from timestamp)
      const sessionId = msg.id || `goose-${msg.created}`
      context.sessionId = sessionId
      events.push({ type: "session", id: sessionId })
    }

    for (const block of msg.content) {
      // Text content from assistant
      if (block.type === "text" && msg.role === "assistant") {
        // A wrapped provider error: stash the detail for `complete` to surface
        // rather than emitting it as ordinary assistant text.
        const errMatch = context && block.text.match(GOOSE_ERROR_TEXT)
        if (errMatch) {
          context!.state.gooseError = errMatch[1].trim()
          continue
        }
        events.push({ type: "token", text: block.text })
      }

      // Tool use (tool call starting)
      if (block.type === "tool_use") {
        events.push(
          createToolStartEvent(block.name, block.input, toolMappings)
        )
      }

      // Tool result (tool call completed)
      if (block.type === "tool_result") {
        let output: string | undefined

        if (typeof block.content === "string") {
          output = block.content
        } else if (Array.isArray(block.content)) {
          const textParts = block.content
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
          output = textParts.join("\n") || undefined
        }

        if (block.is_error && output) {
          output = `Error: ${output}`
        }

        events.push({ type: "tool_end", output })
      }
    }

    return events.length > 0 ? (events.length === 1 ? events[0] : events) : null
  }

  // Complete event marks end of the turn. Surface a wrapped provider error
  // stashed from an earlier assistant message, if any; otherwise a clean end.
  if (json.type === "complete") {
    const err = context?.state.gooseError as string | undefined
    return err ? { type: "end", error: resolveAgentError(err, "goose") } : { type: "end" }
  }

  // Error event
  if (json.type === "error") {
    return { type: "end", error: resolveAgentError(json.error ?? json, "goose") }
  }

  return null
}
