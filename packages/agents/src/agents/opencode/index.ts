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
import { buildAgentCommand } from "../../core/command"
import { parseOpencodeLine } from "./parser"
import { OPENCODE_TOOL_MAPPINGS } from "./tools"

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
    return buildAgentCommand(
      {
        bin: "opencode",
        subcommand: ["run"],
        baseFlags: ["--format", "json", "--variant", "medium"],
        model: { flag: "-m" },
        resume: { flag: "-s", takesValue: true },
        // The "--" sentinel signals end-of-options to OpenCode's argument parser.
        prompt: { style: { kind: "sentinel" } },
        // OpenCode sometimes writes JSON events to stderr; run under bash with 2>&1.
        bashWrap: { shellArgs: ["-lc"], redirectStderr: true },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseOpencodeLine(line, this.toolMappings, context)
  },
}
