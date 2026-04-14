/**
 * ELIZA Therapist Agent Definition
 *
 * A fake agent based on the classic ELIZA therapist chatbot.
 * Uses regex pattern matching (not LLM) and outputs Claude-compatible JSON.
 */

import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parseElizaLine } from "./parser"
import { ELIZA_TOOL_MAPPINGS } from "./tools"

// Get the directory of this file for locating the CLI script
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * ELIZA therapist agent definition.
 *
 * A fake agent that:
 * - Uses classic ELIZA regex pattern matching (deterministic, not random/LLM)
 * - Outputs Claude Code compatible JSON lines with realistic delays
 * - Can create and delete actual files as "therapeutic exercises"
 *
 * Environment variables:
 * - ELIZA_SESSION_ID: Override session ID
 * - ELIZA_CWD: Override working directory for file operations
 * - ELIZA_DELAY_MULTIPLIER: Multiply all delays by this factor (for testing, e.g., 10 for 10x slower)
 */
export const elizaAgent: AgentDefinition = {
  name: "eliza",

  toolMappings: ELIZA_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: false,
  },

  buildCommand(options: RunOptions): CommandSpec {
    // Path to the CLI script
    const cliPath = path.join(__dirname, "cli.js")

    const args: string[] = []

    // Add the prompt if provided
    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "node",
      args: [cliPath, ...args],
      env: {
        ...options.env,
        ELIZA_SESSION_ID: options.sessionId || "",
        ELIZA_CWD: options.cwd || process.cwd(),
      },
      cwd: options.cwd,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseElizaLine(line, this.toolMappings)
  },
}
