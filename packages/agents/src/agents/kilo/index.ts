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
import { buildAgentCommand } from "../../core/command"
import { parseKiloLine } from "./parser"
import { KILO_TOOL_MAPPINGS } from "./tools"

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
    return buildAgentCommand(
      {
        bin: "kilo",
        // --auto auto-approves all permissions (safe in sandbox).
        subcommand: ["run"],
        baseFlags: ["--format", "json", "--auto"],
        model: { flag: "-m" },
        resume: { flag: "-s", takesValue: true },
        // The "--" sentinel signals end-of-options to Kilo's argument parser.
        prompt: { style: { kind: "sentinel" } },
        // Kilo sometimes writes JSON events to stderr; run under bash with 2>&1.
        bashWrap: { shellArgs: ["-lc"], redirectStderr: true },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseKiloLine(line, this.toolMappings, context)
  },
}
