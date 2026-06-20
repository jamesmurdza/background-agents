/**
 * OpenCode CLI Agent Definition
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import type { CodeAgentSandbox } from "../../types/provider"
import { parseOpencodeLine } from "./parser"
import { OPENCODE_TOOL_MAPPINGS } from "./tools"
import { quote } from "../../utils/shell"
import { buildOpencodeConfigJson } from "./config"

/** Global OpenCode config path (not the project root, to avoid touching the repo). */
const OPENCODE_CONFIG_PATH = "~/.config/opencode/opencode.json"

/**
 * OpenCode agent-specific setup. Two mutually exclusive paths:
 *
 * 1. Custom endpoint — when CUSTOM_OPENCODE_BASE_URL is set, write a global
 *    opencode.json defining a custom OpenAI-compatible provider. Auth lives in
 *    the headers blob (promoted to the provider apiKey).
 * 2. Standard — remove any custom opencode.json left over from a previous custom
 *    run in this sandbox, so a custom→standard switch stops using the old
 *    provider. In this app that file is only ever written by the custom path.
 */
async function opencodeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  if (env.CUSTOM_OPENCODE_BASE_URL) {
    const json = buildOpencodeConfigJson({
      baseUrl: env.CUSTOM_OPENCODE_BASE_URL,
      model: env.CUSTOM_OPENCODE_NAME || "",
      headers: env.CUSTOM_OPENCODE_HEADERS || undefined,
      apiKeyEnv: env.CUSTOM_OPENCODE_API_KEY ? "CUSTOM_OPENCODE_API_KEY" : undefined,
    })
    await sandbox.executeCommand(
      `mkdir -p ~/.config/opencode && printf '%s' ${quote(json)} > ${OPENCODE_CONFIG_PATH}`,
      30
    )
    return
  }

  await sandbox.executeCommand(`rm -f ${OPENCODE_CONFIG_PATH}`, 10)
}

/**
 * OpenCode CLI agent definition.
 *
 * Interacts with the OpenCode CLI tool which outputs JSON lines.
 * Wraps command in bash to capture stderr.
 */
export const opencodeAgent: AgentDefinition = {
  name: "opencode",

  toolMappings: OPENCODE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: true,
    setup: opencodeSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    // OpenCode sometimes writes JSON events to stderr; run under bash and redirect 2>&1.
    // --print-logs --log-level ERROR surfaces model-call (service=llm) failures as
    // plaintext ERROR lines. On a retryable error (rate/usage limit, overload),
    // OpenCode emits no JSON event and retries with unbounded backoff; without these
    // logs the turn hangs forever on the "generating" spinner. The parser reads the
    // ERROR lines and ends the turn with the real error instead. ERROR level keeps the
    // extra output minimal (no INFO/WARN flood).
    const parts: string[] = [
      "opencode",
      "run",
      "--format",
      "json",
      "--print-logs",
      "--log-level",
      "ERROR",
      "--variant",
      "medium",
    ]

    if (options.model) {
      parts.push("-m", quote(options.model))
    }

    if (options.sessionId) {
      parts.push("-s", quote(options.sessionId))
    }

    // The "--" sentinel signals end-of-options to the OpenCode's argument parser
    if (options.prompt) {
      parts.push("--")
      parts.push(quote(options.prompt))
    }

    const command = `${parts.join(" ")} 2>&1`

    // Build environment variables
    const env: Record<string, string> = {
      ...options.env,
    }

    return {
      cmd: "bash",
      args: ["-lc", command],
      env,
      wrapInBash: false, // Already wrapped
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseOpencodeLine(line, this.toolMappings, context)
  },
}
