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
import { buildAgentCommand } from "../../core/command"
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
    return buildAgentCommand(
      {
        bin: "gemini",
        // Stream JSON for event parsing; skip trust checks (controlled env).
        baseFlags: ["--output-format", "stream-json", "--skip-trust"],
        // Plan mode is read-only; otherwise full tool access (safe in sandbox).
        planMode: { flags: ["--approval-mode", "plan"], defaultFlags: ["--yolo"] },
        model: { flag: "--model" },
        resume: { flag: "--resume", takesValue: true },
        prompt: { style: { kind: "flag", flag: "-p" } },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseGeminiLine(line, this.toolMappings, context)
  },
}
