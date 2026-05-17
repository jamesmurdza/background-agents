/**
 * OpenCode CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseOpencodeLine } from "./parser"
import { OPENCODE_TOOL_MAPPINGS } from "./tools"

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
    // Debug: log planMode to verify it's being passed correctly
    console.log(`[opencode buildCommand] planMode=${options.planMode}`)

    // OpenCode sometimes writes JSON events to stderr; run under bash and redirect 2>&1
    const parts: string[] = ["opencode", "run", "--format", "json", "--variant", "medium"]

    if (options.model) {
      parts.push("-m", quote(options.model))
    }

    if (options.sessionId) {
      parts.push("-s", quote(options.sessionId))
    }

    // The "--" sentinel signals end-of-options to the OpenCode's argument parser
    if (options.prompt) {
      parts.push("--")
      parts.push(quote(options.prompt))
    }

    const command = `${parts.join(" ")} 2>&1`

    // Build environment variables
    const env: Record<string, string> = {
      ...options.env,
    }

    if (options.planMode) {
      // Enable CLI-enforced plan mode (read-only)
      // OPENCODE_EXPERIMENTAL_PLAN_MODE has a known bug where it still allows edits,
      // so we also set permissions to deny all file modification and execution tools
      env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "1"
      env.OPENCODE_PERMISSION = JSON.stringify({
        "*": "allow",
        "edit": "deny",
        "write": "deny",
        "apply_patch": "deny",
        "bash": "deny",
        "task": "deny",
      })
    } else {
      // Allow all tool actions without interactive approval in headless runs
      env.OPENCODE_PERMISSION = '{"*":"allow"}'
    }

    return {
      cmd: "bash",
      args: ["-lc", command],
      env,
      wrapInBash: false, // Already wrapped
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseOpencodeLine(line, this.toolMappings, context)
  },
}
