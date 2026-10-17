/**
 * Command Code CLI Agent Definition
 *
 * Command Code (commandcode.ai) is a Claude-Code-shaped CLI: `-p` runs
 * headless, `--output-format json` streams NDJSON event frames, `-m <model>`
 * picks the model and `--resume <id>` continues a session.
 *
 * Auth is a single Command Code API key. The CLI reads COMMAND_CODE_API_KEY
 * from the environment and prefers it over ~/.commandcode/auth.json, so
 * injecting the env var is all the sandbox needs — no login flow, no config
 * file. Print mode refuses to start without it (exit 3), and that gate applies
 * even to BYOK providers, which is why every Command Code model in
 * `agentModels` requires this one key rather than the user's Anthropic/OpenAI
 * key. Models route through the user's own plan; ids are the catalog's exact
 * ids (`claude-sonnet-5`, `deepseek/deepseek-v4-flash`, …).
 *
 * Skills and MCP need no per-run wiring here: Command Code discovers
 * user-level skills from ~/.agents/skills, which is exactly where
 * @background-agents/sandbox-skills installs them, and reads MCP servers from
 * ~/.commandcode/mcp.json, which @background-agents/agent-configuration writes
 * before the session starts.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseCommandCodeLine } from "./parser"
import { COMMAND_CODE_TOOL_MAPPINGS } from "./tools"
import { thinkingArgs } from "../../thinking"

/**
 * Default environment applied to every Command Code invocation.
 *
 * COMMANDCODE_DISABLE_CRON=1 turns off the CLI's scheduling tools so a turn
 * can't leave recurring work running in the sandbox after it ends (the same
 * reasoning as CLAUDE_CODE_DISABLE_BACKGROUND_TASKS for Claude Code). Callers
 * can still override it through RunOptions.env.
 */
const COMMAND_CODE_DEFAULT_ENV: Record<string, string> = {
  COMMANDCODE_DISABLE_CRON: "1",
}

/**
 * Command Code CLI agent definition.
 *
 * Runs the `commandcode` binary rather than its short `cmd` alias: the package
 * installs both, and the long name keeps this command — and the PATH probe in
 * ensureProvider — unambiguous.
 */
export const commandCodeAgent: AgentDefinition = {
  name: "commandcode",

  toolMappings: COMMAND_CODE_TOOL_MAPPINGS,

  capabilities: {
    // No --system-prompt flag; rely on the synthetic prefix instead.
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: true,
    // No setup(): the API key travels as an env var, so there is no config
    // file to write.
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = [
      ...thinkingArgs("commandcode", options.model, options.thinking),
      // NDJSON event frames + one final result line (see the parser).
      "--output-format",
      "json",
      // Taste onboarding is an interactive first-run flow; skip it for CI runs.
      "--skip-onboarding",
      // The repo is cloned fresh into the sandbox, so trust it up front instead
      // of stalling on the first-run trust prompt.
      "--trust",
      // Never let the CLI update itself mid-turn.
      "--no-auto-update",
    ]

    if (options.planMode) {
      // Plan mode keeps the run read-only and has the model write the plan out.
      args.push("--permission-mode", "plan")
    } else {
      // Headless runs block file writes and shell commands by default.
      args.push("--yolo")
    }

    if (options.model) {
      args.push("--model", options.model)
    }

    if (options.sessionId) {
      args.push("--resume", options.sessionId)
    }

    // `-p` takes the query as an *optional* value, so it goes last: any flag
    // after it would be swallowed as the prompt.
    args.push("-p")
    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "commandcode",
      args,
      env: { ...COMMAND_CODE_DEFAULT_ENV, ...options.env },
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseCommandCodeLine(line, this.toolMappings, context)
  },
}
