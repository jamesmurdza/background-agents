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
    const gooseArgs: string[] = []

    // Use run subcommand for non-interactive execution
    gooseArgs.push("run")

    // Enable JSON streaming output for machine-readable events
    gooseArgs.push("--output-format", "stream-json")

    // Add prompt as text input
    if (options.prompt) {
      gooseArgs.push("--text", options.prompt)
    }

    // Apply system prompt via --system flag when provided
    if (options.systemPrompt) {
      gooseArgs.push("--system", options.systemPrompt)
    }

    // Resume session by name if provided
    if (options.sessionId) {
      gooseArgs.push("--name", options.sessionId, "--resume")
    }

    // Build the goose command string (will be passed to bash -c)
    const gooseCmd = ["goose", ...gooseArgs].map(arg => {
      // Quote args that contain spaces or special characters
      if (arg.includes(" ") || arg.includes('"') || arg.includes("'") || arg.includes("\n")) {
        return `'${arg.replace(/'/g, "'\\''")}'`
      }
      return arg
    }).join(" ")

    // Wrap in bash to ensure PATH includes ~/.local/bin where goose installs
    return {
      cmd: "bash",
      args: ["-c", `export PATH="$HOME/.local/bin:$PATH" && ${gooseCmd}`],
      env: options.env,
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseGooseLine(line, this.toolMappings, context)
  },
}
