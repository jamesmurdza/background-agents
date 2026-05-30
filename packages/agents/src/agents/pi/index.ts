/**
 * Pi Coding Agent CLI Agent Definition
 *
 * Pi is a minimal terminal coding harness from @mariozechner/pi-coding-agent.
 * https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { buildAgentCommand } from "../../core/command"
import { parsePiLine } from "./parser"
import { PI_TOOL_MAPPINGS } from "./tools"

/**
 * Pi Coding Agent CLI agent definition.
 *
 * Interacts with the Pi CLI tool which outputs JSON lines in --mode json format.
 */
export const piAgent: AgentDefinition = {
  name: "pi",

  toolMappings: PI_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    return buildAgentCommand(
      {
        bin: "pi",
        // JSON mode for structured output.
        baseFlags: ["--mode", "json"],
        systemPromptFlag: "--system-prompt",
        // Pi supports provider/model format like "openai/gpt-4o".
        model: { flag: "--model" },
        // --continue resumes the last session in cwd.
        resume: { flag: "--continue" },
        prompt: { style: { kind: "flag", flag: "-p" } },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parsePiLine(line, this.toolMappings, context)
  },
}
