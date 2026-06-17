/**
 * Google Gemini CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseGeminiLine } from "./parser"
import { GEMINI_TOOL_MAPPINGS } from "./tools"

/**
 * Google Gemini CLI agent definition.
 *
 * Interacts with the Gemini CLI tool which outputs JSON lines.
 */
export const geminiAgent: AgentDefinition = {
  name: "gemini",

  toolMappings: GEMINI_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Stream JSON for event parsing
    args.push("--output-format", "stream-json")

    // Skip trust checks since we're in a controlled environment
    args.push("--skip-trust")

    if (options.planMode) {
      // Enable CLI-enforced plan mode (read-only)
      args.push("--approval-mode", "plan")
    } else {
      // Enable full tool access (shell, file writes, etc.) - safe in sandbox environment
      args.push("--yolo")
    }             
                                      

    // Add model if specified (e.g., "gemini-2.0-flash", "gemini-1.5-pro")
    if (options.model) {
      args.push("--model", options.model)
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push("--resume", options.sessionId)
    }

    // Add prompt with -p flag if provided
    if (options.prompt) {
      args.push("-p", options.prompt)
    }

    return {
      cmd: "gemini",
      args,
      env: options.env,
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseGeminiLine(line, this.toolMappings, context)
  },
}
