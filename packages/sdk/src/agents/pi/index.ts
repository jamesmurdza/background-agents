/**
 * Pi Coding Agent CLI Agent Definition
 *
 * Pi is a minimal terminal coding harness from @mariozechner/pi-coding-agent.
 * https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parsePiLine } from "./parser"
import { PI_TOOL_MAPPINGS } from "./tools"
import { thinkingArgs } from "../../thinking"
import { piModelIdentity } from "./model-identity"

/**
 * Pi Coding Agent CLI agent definition.
 *
 * Interacts with the Pi CLI tool which outputs JSON lines in --mode json format.
 */
export const piAgent: AgentDefinition = {
  name: "pi",

  toolMappings: PI_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args = thinkingArgs("pi", options.model, options.thinking)

    // Use JSON mode for structured output
    args.push("--mode", "json")

    // Apply system prompt via native CLI flag when provided
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt)
    }

    // Pi natively accepts provider/model. Use the same exact identity as the
    // capability lookup, including the picker's legacy bare Anthropic IDs.
    // Unknown patterns remain native Default-only requests, not guessed models.
    if (options.model) {
      args.push("--model", piModelIdentity(options.model) ?? options.model)
    }

    // Resume this chat's native session, not another tab's latest session.
    if (options.sessionId) {
      args.push("--session", options.sessionId)
    }

    // Add the prompt if provided
    if (options.prompt) {
      args.push("-p")
      args.push(options.prompt)
    }

    return {
      cmd: "pi",
      args,
      env: options.env,
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parsePiLine(line, this.toolMappings, context)
  },
}
