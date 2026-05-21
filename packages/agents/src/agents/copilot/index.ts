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
    const args: string[] = []

    // Prompt — must come right after -p
    if (options.prompt) {
      args.push("-p", options.prompt)
    }

    // Machine-readable JSONL output
    args.push("--output-format=json")

    // Suppress interactive chrome
    args.push("--silent")

    // Full autopilot — no permission prompts
    args.push("--autopilot")

    // Model selection
    if (options.model) {
      args.push("--model", options.model)
    }

    // Session resume — --continue resumes the last session
    if (options.sessionId) {
      args.push("--continue")
    }

    return {
      cmd: "copilot",
      args,
      env: options.env,
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseCopilotLine(line, this.toolMappings, context)
  },
}
