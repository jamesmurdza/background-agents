/**
 * OpenAI Codex CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import type { CodeAgentSandbox } from "../../types/provider"
import { escapeShell } from "../../utils/shell"
import { parseCodexLine } from "./parser"
import { CODEX_TOOL_MAPPINGS } from "./tools"

/**
 * Codex agent-specific setup: login with API key
 */
async function codexSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!env.OPENAI_API_KEY || !sandbox.executeCommand) return

  const safeKey = escapeShell(env.OPENAI_API_KEY)
  await sandbox.executeCommand(
    `echo '${safeKey}' | codex login --with-api-key 2>&1`,
    30
  )
}

/**
 * OpenAI Codex CLI agent definition.
 *
 * Interacts with the Codex CLI tool which outputs JSON lines.
 */
export const codexAgent: AgentDefinition = {
  name: "codex",

  toolMappings: CODEX_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: true,
    setup: codexSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Use exec subcommand for non-interactive mode with JSON output
    args.push("exec")

    // JSON output for streaming events
    args.push("--json")

    // Skip git repo check for sandbox environments
    args.push("--skip-git-repo-check")

    if (options.planMode) {
      // Enable CLI-enforced plan mode (read-only)
      args.push("--sandbox", "read-only")
    } else {
      // Skip permission prompts when already running in a sandbox
      args.push("--yolo")
    }

    // Add model if specified (e.g., "gpt-4o", "o1", "o3")
    if (options.model) {
      args.push("--model", options.model)
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push("resume", options.sessionId)
    }

    // The "--" sentinel signals end-of-options to the Codex CLI's argument parser
    if (options.prompt) {
      args.push("--")
      args.push(options.prompt)
    }

    return {
      cmd: "codex",
      args,
      env: options.env,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseCodexLine(line, this.toolMappings)
  },
}
