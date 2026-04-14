/**
 * ELIZA Therapist Agent Definition
 *
 * A fake agent based on the classic ELIZA therapist chatbot.
 * Uses regex pattern matching (not LLM) and outputs Claude-compatible JSON.
 */

import * as path from "node:path"
import * as fs from "node:fs"
import { fileURLToPath } from "node:url"
import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import { parseElizaLine } from "./parser.js"
import { ELIZA_TOOL_MAPPINGS } from "./tools.js"

// Get the directory of this file for locating the CLI script
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Find the CLI script path.
 * When running from dist/, __dirname points to dist/agents/eliza/ and cli.js is there.
 * When running from src/ (e.g., via ts-node), __dirname points to src/agents/eliza/
 * but cli.js is in dist/agents/eliza/, so we need to resolve it.
 */
function getCliPath(): string {
  // First, try the path relative to this file (works when running from dist/)
  const localPath = path.join(__dirname, "cli.js")
  if (fs.existsSync(localPath)) {
    return localPath
  }

  // If we're in src/, look for the compiled version in dist/
  // __dirname = /path/to/packages/agents/src/agents/eliza
  // We need:  /path/to/packages/agents/dist/agents/eliza/cli.js
  const srcMatch = __dirname.match(/^(.*)\/src\/agents\/eliza$/)
  if (srcMatch) {
    const distPath = path.join(srcMatch[1], "dist", "agents", "eliza", "cli.js")
    if (fs.existsSync(distPath)) {
      return distPath
    }
  }

  // Fallback: assume it's relative to this file
  return localPath
}

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
    // Path to the CLI script (handles both dist/ and src/ execution)
    const cliPath = getCliPath()

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
