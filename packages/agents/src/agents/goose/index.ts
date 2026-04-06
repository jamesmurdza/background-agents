/**
 * Goose CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parseGooseLine } from "./parser.js"
import { GOOSE_TOOL_MAPPINGS } from "./tools.js"

/**
 * Determine the goose provider and model based on the model name and environment.
 * Goose supports multiple providers: openai, anthropic, ollama, etc.
 */
function getGooseProviderAndModel(
  model: string | undefined,
  env: Record<string, string> | undefined
): { provider: string; model: string } {
  // If model contains "claude", use anthropic provider
  if (model?.toLowerCase().includes("claude")) {
    return { provider: "anthropic", model: model }
  }

  // If ANTHROPIC_API_KEY is set but not OPENAI_API_KEY, use anthropic
  if (env?.ANTHROPIC_API_KEY && !env?.OPENAI_API_KEY) {
    return { provider: "anthropic", model: model || "claude-sonnet-4-5" }
  }

  // Default to OpenAI provider
  return { provider: "openai", model: model || "gpt-4o" }
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

    // Determine provider and model based on model name and environment
    const { provider, model } = getGooseProviderAndModel(options.model, options.env)
    gooseArgs.push("--provider", provider)
    gooseArgs.push("--model", model)

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
