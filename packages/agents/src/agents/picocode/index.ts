/**
 * Picocode CLI Agent Definition
 *
 * Picocode is a minimal, high-performance Rust-based coding agent.
 * https://github.com/jondot/picocode
 *
 * Since Picocode doesn't have native JSON streaming output, this agent
 * captures its console output and parses it to extract events.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parsePicocodeLine } from "./parser.js"
import { PICOCODE_TOOL_MAPPINGS } from "./tools.js"

/**
 * Quote a string for bash
 */
function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Picocode CLI agent definition.
 *
 * Interacts with the Picocode CLI tool.
 * Runs with --yolo flag to skip confirmation prompts in sandbox.
 */
export const picocodeAgent: AgentDefinition = {
  name: "picocode",

  toolMappings: PICOCODE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false, // Picocode uses persona system, not direct system prompts
    supportsResume: false, // No session resumption support
  },

  buildCommand(options: RunOptions): CommandSpec {
    // Build the picocode command
    // Using 'input' subcommand for single prompt execution
    const parts: string[] = ["picocode"]

    // Model selection via provider
    // Picocode supports: anthropic, openai, azure, cohere, deepseek, galadriel,
    // gemini, groq, huggingface, hyperbolic, mira, mistral, moonshot, ollama,
    // openrouter, perplexity, together, xai
    if (options.model) {
      // If model contains a provider prefix (e.g., "anthropic/claude-3-opus"),
      // extract and use it
      const modelParts = options.model.split("/")
      if (modelParts.length > 1) {
        parts.push("-p", modelParts[0])
        parts.push("-m", quote(modelParts.slice(1).join("/")))
      } else {
        // Assume it's just a model name for the default provider (anthropic)
        parts.push("-m", quote(options.model))
      }
    }

    // Enable yolo mode to skip confirmation prompts (safe in sandbox)
    parts.push("--yolo")

    // Add the prompt using the 'input' subcommand
    if (options.prompt) {
      parts.push("input", quote(options.prompt))
    }

    // Redirect stderr to stdout to capture all output
    const command = `${parts.join(" ")} 2>&1`

    return {
      cmd: "bash",
      args: ["-lc", command],
      env: {
        // Set provider API keys from environment
        // Picocode will use the appropriate one based on --provider flag
        ...options.env,
      },
      wrapInBash: false, // Already wrapped
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parsePicocodeLine(line, this.toolMappings, context)
  },
}
