/**
 * Claude Code CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent"
import type { CodeAgentSandbox } from "../../types/provider"
import type { Event } from "../../types/events"
import { parseClaudeLine } from "./parser"
import { CLAUDE_TOOL_MAPPINGS } from "./tools"
import { escapeShell } from "../../utils/shell"
import { CLAUDE_OAUTH_RUNNER_PATH, CLAUDE_OAUTH_RUNNER_SOURCE } from "./oauth-runner"

/** Claude credentials directory */
const CLAUDE_CREDENTIALS_DIR = "/home/daytona/.claude"
/** Claude credentials file */
const CLAUDE_CREDENTIALS_FILE = "/home/daytona/.claude/.credentials.json"
/** Environment variable name for Claude Code credentials */
const CLAUDE_CODE_CREDENTIALS_ENV = "CLAUDE_CODE_CREDENTIALS"

/**
 * Default environment variables applied to every Claude CLI invocation.
 *
 * CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 disables all background task
 * functionality in the Claude Code CLI. We hardcode it on by default so
 * background sessions never spawn detached background tasks. Callers can
 * still override it by passing their own value via RunOptions.env.
 */
const CLAUDE_DEFAULT_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
}

/**
 * Claude agent-specific setup: write credentials from environment variable.
 *
 * When CLAUDE_CODE_CREDENTIALS environment variable is set, this function
 * writes its contents to ~/.claude/.credentials.json. This allows credentials
 * to be passed via environment variable instead of writing the file manually.
 *
 * The value should be the JSON content of the credentials file, e.g.:
 * {"claudeAiOauth":{"accessToken":"sk-ant-oa..."}}
 *
 * Custom-endpoint runs (ANTHROPIC_BASE_URL set, no subscription token) instead
 * remove a stale ~/.claude/.credentials.json left by an earlier standard run in
 * the same sandbox, so a leftover subscription/OAuth token can't shadow the
 * custom endpoint's ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN auth. In this app that
 * file is only ever written from CLAUDE_CODE_CREDENTIALS, so removing it is safe.
 */
async function claudeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  if (env.CLAUDE_CODE_TOKEN_URL && env.CLAUDE_CODE_TOKEN_AUTH) {
    // The host owns shared refresh credentials. Clear an earlier subscription
    // file, then install a static protocol bridge without embedding any token.
    await sandbox.executeCommand(
      `rm -f '${CLAUDE_CREDENTIALS_FILE}' && printf '%s' '${escapeShell(CLAUDE_OAUTH_RUNNER_SOURCE)}' > '${CLAUDE_OAUTH_RUNNER_PATH}' && chmod 600 '${CLAUDE_OAUTH_RUNNER_PATH}'`,
      30
    )
    return
  }

  const credentialsJson = env[CLAUDE_CODE_CREDENTIALS_ENV]
  if (credentialsJson) {
    // Escape single quotes for shell command
    const safeCredentials = escapeShell(credentialsJson)

    // Create directory and write credentials file with secure permissions
    await sandbox.executeCommand(
      `mkdir -p '${CLAUDE_CREDENTIALS_DIR}' && echo '${safeCredentials}' > '${CLAUDE_CREDENTIALS_FILE}' && chmod 600 '${CLAUDE_CREDENTIALS_FILE}'`,
      30
    )
    return
  }

  // Custom endpoint run: clear any stale credentials file from a prior standard run.
  if (env.ANTHROPIC_BASE_URL) {
    await sandbox.executeCommand(`rm -f '${CLAUDE_CREDENTIALS_FILE}'`, 10)
  }
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
    supportsPlanMode: true,
    setup: claudeSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Print mode for non-interactive usage
    args.push("-p")

    // Add output format flag for JSON streaming (requires --verbose)
    args.push("--output-format", "stream-json", "--verbose")

    // Enable CLI-enforced plan mode (read-only)
    // Must be set BEFORE --dangerously-skip-permissions check
    if (options.planMode) {
      args.push("--permission-mode", "plan")
    } else {
      // Only skip permission prompts when NOT in plan mode
      // In plan mode, we want the CLI to enforce read-only restrictions
      args.push("--dangerously-skip-permissions")
    }

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

    // The "--" sentinel signals end-of-options to the Claude CLI's argument parser
    if (options.prompt) {
      args.push("--")
      args.push(options.prompt)
    }

    return {
      cmd: options.env?.CLAUDE_CODE_TOKEN_URL && options.env.CLAUDE_CODE_TOKEN_AUTH ? "node" : "claude",
      args: options.env?.CLAUDE_CODE_TOKEN_URL && options.env.CLAUDE_CODE_TOKEN_AUTH
        ? [CLAUDE_OAUTH_RUNNER_PATH, ...args] : args,
      // Hardcode the background-task-disabling default, but let any
      // caller-provided env override it.
      env: { ...CLAUDE_DEFAULT_ENV, ...options.env },
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseClaudeLine(line, this.toolMappings)
  },
}
