/**
 * Claude Code CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent"
import type { CodeAgentSandbox } from "../../types/provider"
import type { Event } from "../../types/events"
import { parseClaudeLine } from "./parser"
import { CLAUDE_TOOL_MAPPINGS } from "./tools"

/** Claude credentials directory */
const CLAUDE_CREDENTIALS_DIR = "/home/daytona/.claude"
/** Claude credentials file */
const CLAUDE_CREDENTIALS_FILE = "/home/daytona/.claude/.credentials.json"
/** Environment variable name for Claude Code credentials */
const CLAUDE_CODE_CREDENTIALS_ENV = "CLAUDE_CODE_CREDENTIALS"

/**
 * Claude agent-specific setup: write credentials from environment variable.
 *
 * When CLAUDE_CODE_CREDENTIALS environment variable is set, this function
 * writes its contents to ~/.claude/.credentials.json. This allows credentials
 * to be passed via environment variable instead of writing the file manually.
 *
 * The value should be the JSON content of the credentials file, e.g.:
 * {"claudeAiOauth":{"accessToken":"sk-ant-oa..."}}
 */
async function claudeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  const credentialsJson = env[CLAUDE_CODE_CREDENTIALS_ENV]
  if (!credentialsJson || !sandbox.executeCommand) return

  // Escape single quotes for shell command
  const safeCredentials = credentialsJson.replace(/'/g, "'\\''")

  // Create directory and write credentials file with secure permissions
  await sandbox.executeCommand(
    `mkdir -p '${CLAUDE_CREDENTIALS_DIR}' && echo '${safeCredentials}' > '${CLAUDE_CREDENTIALS_FILE}' && chmod 600 '${CLAUDE_CREDENTIALS_FILE}'`,
    30
  )
}

/**
 * Claude Code CLI agent definition.
 *
 * Interacts with the Claude CLI tool which outputs JSON lines in stream-json format.
 */
export const claudeAgent: AgentDefinition = {
  name: "claude",

  toolMappings: CLAUDE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
    setup: claudeSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Print mode for non-interactive usage
    args.push("-p")

    // Add output format flag for JSON streaming (requires --verbose)
    args.push("--output-format", "stream-json", "--verbose")

    // Skip permission prompts when already running in a sandbox
    args.push("--dangerously-skip-permissions")

    // Apply system prompt via native CLI flag when provided
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt)
    }

    // Add model if specified (e.g., "sonnet", "opus", "claude-sonnet-4-5-20250929")
    if (options.model) {
      args.push("--model", options.model)
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push("--resume", options.sessionId)
    }

    // Add the prompt if provided
    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "claude",
      args,
      env: options.env,
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseClaudeLine(line, this.toolMappings)
  },
}
