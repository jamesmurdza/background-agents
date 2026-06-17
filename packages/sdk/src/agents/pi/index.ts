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
    const args: string[] = []

    // Use JSON mode for structured output
    args.push("--mode", "json")

    // Apply system prompt via native CLI flag when provided
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt)
    }

    // Add model if specified (e.g., "sonnet", "gpt-4o", "claude-sonnet-4-5-20250929")
    // Pi supports provider/model format like "openai/gpt-4o" or model patterns
    if (options.model) {
      args.push("--model", options.model)
    }

    // Continue the most recent session in the current directory
    // Pi's --continue flag resumes the last session in cwd
    if (options.sessionId) {
      args.push("--continue")
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
