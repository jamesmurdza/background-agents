/**
 * Goose CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parseGooseLine } from "./parser.js"
import { GOOSE_TOOL_MAPPINGS } from "./tools.js"

/**
 * Goose CLI agent definition.
 *
 * Interacts with the Goose CLI tool (Block's open source AI coding agent).
 */
export const gooseAgent: AgentDefinition = {
  name: "goose",

  toolMappings: GOOSE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Use run subcommand for non-interactive execution
    args.push("run")

    // Add prompt as text input
    if (options.prompt) {
      args.push("--text", options.prompt)
    }

    // Apply system prompt via --system flag when provided
    if (options.systemPrompt) {
      args.push("--system", options.systemPrompt)
    }

    // Resume session by name if provided
    if (options.sessionId) {
      args.push("--name", options.sessionId, "--resume")
    }

    return {
      cmd: "goose",
      args,
      env: options.env,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseGooseLine(line, this.toolMappings)
  },
}
