/**
 * Claude Code CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent"
import type { CodeAgentSandbox } from "../../types/provider"
import type { Event } from "../../types/events"
import { buildAgentCommand } from "../../core/command"
import { parseClaudeLine } from "./parser"
import { CLAUDE_TOOL_MAPPINGS } from "./tools"
import { escapeShell } from "../../utils/shell"

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
 */
async function claudeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  const credentialsJson = env[CLAUDE_CODE_CREDENTIALS_ENV]
  if (!credentialsJson || !sandbox.executeCommand) return

  // Escape single quotes for shell command
  const safeCredentials = escapeShell(credentialsJson)

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
    supportsPlanMode: true,
    setup: claudeSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    return buildAgentCommand(
      {
        bin: "claude",
        // Print mode + JSON streaming (stream-json requires --verbose).
        baseFlags: ["-p", "--output-format", "stream-json", "--verbose"],
        // Plan mode enforces read-only; otherwise skip permission prompts.
        planMode: {
          flags: ["--permission-mode", "plan"],
          defaultFlags: ["--dangerously-skip-permissions"],
        },
        systemPromptFlag: "--system-prompt",
        model: { flag: "--model" },
        resume: { flag: "--resume", takesValue: true },
        // The "--" sentinel signals end-of-options to the Claude CLI.
        prompt: { style: { kind: "sentinel" } },
        // Hardcode the background-task-disabling default, but let any
        // caller-provided env override it.
        defaultEnv: CLAUDE_DEFAULT_ENV,
      },
      options
    )
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseClaudeLine(line, this.toolMappings)
  },
}
