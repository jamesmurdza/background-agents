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
import { buildAgentCommand } from "../../core/command"
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

  const safeKey = env.OPENAI_API_KEY.replace(/'/g, "'\\''")
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
    return buildAgentCommand(
      {
        bin: "codex",
        // exec = non-interactive mode; --json = streaming events;
        // --skip-git-repo-check for sandbox environments.
        subcommand: ["exec"],
        baseFlags: ["--json", "--skip-git-repo-check"],
        // Plan mode runs read-only; otherwise skip permission prompts.
        planMode: { flags: ["--sandbox", "read-only"], defaultFlags: ["--yolo"] },
        model: { flag: "--model" },
        // Codex resumes via the positional `resume <sessionId>` form.
        resume: { flag: "resume", takesValue: true },
        // The "--" sentinel signals end-of-options to the Codex CLI.
        prompt: { style: { kind: "sentinel" } },
      },
      options
    )
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseCodexLine(line, this.toolMappings)
  },
}
