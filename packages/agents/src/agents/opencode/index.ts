/**
 * OpenCode CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parseOpencodeLine } from "./parser.js"
import { OPENCODE_TOOL_MAPPINGS } from "./tools.js"

/**
 * Quote a string for bash
 */
function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * OpenCode CLI agent definition.
 *
 * Interacts with the OpenCode CLI tool which outputs JSON lines.
 * Wraps command in bash to capture stderr.
 */
export const opencodeAgent: AgentDefinition = {
  name: "opencode",

  toolMappings: OPENCODE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    // OpenCode sometimes writes JSON events to stderr; run under bash and redirect 2>&1
    const parts: string[] = ["opencode", "run", "--format", "json", "--variant", "medium"]

    if (options.model) {
      parts.push("-m", quote(options.model))
    }

    if (options.sessionId) {
      parts.push("-s", quote(options.sessionId))
    }

    if (options.prompt) {
      parts.push(quote(options.prompt))
    }

    const command = `${parts.join(" ")} 2>&1`

    return {
      cmd: "bash",
      args: ["-lc", command],
      env: {
        // Allow all tool actions without interactive approval in headless runs
        OPENCODE_PERMISSION: '{"*":"allow"}',
        ...options.env,
      },
      wrapInBash: false, // Already wrapped
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseOpencodeLine(line, this.toolMappings, context)
  },
}
