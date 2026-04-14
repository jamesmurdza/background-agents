/**
 * ELIZA Therapist Agent Definition
 *
 * A fake agent based on the classic ELIZA therapist chatbot.
 * Uses regex pattern matching (not LLM) and outputs Claude-compatible JSON.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseElizaLine } from "./parser"
import { ELIZA_TOOL_MAPPINGS } from "./tools"

// Path where ELIZA bundle is uploaded in the sandbox
// This must match ELIZA_SANDBOX_PATH in sandbox/daytona.ts
const ELIZA_SANDBOX_PATH = "/tmp/eliza-cli.bundle.js"

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
    const args: string[] = []

    // Add the prompt if provided
    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      // ELIZA bundle is uploaded to sandbox at ELIZA_SANDBOX_PATH by ensureProvider()
      cmd: "node",
      args: [ELIZA_SANDBOX_PATH, ...args],
      env: {
        ...options.env,
        ELIZA_SESSION_ID: options.sessionId || "",
        ELIZA_CWD: options.cwd || "/home/daytona",
      },
      cwd: options.cwd,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseElizaLine(line, this.toolMappings)
  },
}
