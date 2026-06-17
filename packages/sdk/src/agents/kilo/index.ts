/**
 * Kilo CLI Agent Definition
 *
 * Kilo is a fork of OpenCode with its own gateway and model catalog.
 * Uses --auto flag for fully autonomous runs in sandbox environments.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseKiloLine } from "./parser"
import { KILO_TOOL_MAPPINGS } from "./tools"
import { quote } from "../../utils/shell"

/**
 * Kilo CLI agent definition.
 *
 * Interacts with the Kilo CLI tool which outputs JSON lines.
 * Uses --auto to auto-approve all permissions (safe in sandbox).
 * Wraps command in bash to capture stderr.
 */
export const kiloAgent: AgentDefinition = {
  name: "kilo",

  toolMappings: KILO_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    // Kilo sometimes writes JSON events to stderr; run under bash and redirect 2>&1
    const parts: string[] = ["kilo", "run", "--format", "json", "--auto"]

    if (options.model) {
      parts.push("-m", quote(options.model))
    }

    if (options.sessionId) {
      parts.push("-s", quote(options.sessionId))
    }

    // The "--" sentinel signals end-of-options to Kilo's argument parser
    if (options.prompt) {
      parts.push("--")
      parts.push(quote(options.prompt))
    }

    const command = `${parts.join(" ")} 2>&1`

    // Build environment variables
    const env: Record<string, string> = {
      ...options.env,
    }

    return {
      cmd: "bash",
      args: ["-lc", command],
      env,
      wrapInBash: false, // Already wrapped
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseKiloLine(line, this.toolMappings, context)
  },
}
