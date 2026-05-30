/**
 * GitHub Copilot CLI Agent Definition
 *
 * Provider-bound agent requiring a fine-grained GitHub PAT
 * with "Copilot Requests" permission. The token is injected
 * as COPILOT_GITHUB_TOKEN via the env var system — no explicit
 * setup() step needed.
 *
 * Headless invocation: copilot -p "<prompt>" --output-format=json --silent --autopilot
 * Session resume:      copilot -p "<prompt>" --output-format=json --silent --autopilot --continue
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { buildAgentCommand } from "../../core/command"
import { parseCopilotLine } from "./parser"
import { COPILOT_TOOL_MAPPINGS } from "./tools"

/**
 * GitHub Copilot CLI agent definition.
 */
export const copilotAgent: AgentDefinition = {
  name: "copilot",

  toolMappings: COPILOT_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: false,
  },

  buildCommand(options: RunOptions): CommandSpec {
    return buildAgentCommand(
      {
        bin: "copilot",
        // Prompt must come right after -p, before the other flags.
        prompt: { style: { kind: "flag", flag: "-p" }, position: "first" },
        // JSONL output, suppress interactive chrome, full autopilot.
        baseFlags: ["--output-format=json", "--silent", "--autopilot"],
        model: { flag: "--model" },
        // --continue resumes the last session.
        resume: { flag: "--continue" },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseCopilotLine(line, this.toolMappings, context)
  },
}
