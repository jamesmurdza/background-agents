/**
 * Goose CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent"
import type { Event } from "../../types/events"
import { parseGooseLine } from "./parser"
import { GOOSE_TOOL_MAPPINGS } from "./tools"

/**
 * Determine the goose provider based on the given model name.
 * Goose supports multiple providers: openai, anthropic, ollama, etc.
 */
function getGooseProvider(model: string): string {
  // If model contains "claude", use anthropic provider
  if (model.toLowerCase().includes("claude")) {
    return "anthropic"
  }

  // Default to OpenAI provider
  return "openai"
}

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

    // Only set provider and model flags if a model is explicitly requested
    if (options.model) {
      const provider = getGooseProvider(options.model)
      gooseArgs.push("--provider", provider)
      gooseArgs.push("--model", options.model)
    }

    // Add prompt as text input
    if (options.prompt) {
      gooseArgs.push("--text", options.prompt)
    }

    // Apply system prompt via --system flag when provided
    if (options.systemPrompt) {
      gooseArgs.push("--system", options.systemPrompt)
    }

    // Session handling: goose resumes the most recent session when --resume is used
    // First message (no sessionId): creates new session
    // Subsequent messages (has sessionId): resumes most recent session
    if (options.sessionId) {
      gooseArgs.push("--resume")
    }

    // Build the goose command string (will be passed to bash -c)
    const gooseCmd = ["goose", ...gooseArgs].map(arg => {
      return `'${arg.replace(/'/g, "'\\''")}'`
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
