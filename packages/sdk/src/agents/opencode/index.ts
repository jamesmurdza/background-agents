/**
 * OpenCode CLI Agent Definition
 */

import { randomUUID } from "node:crypto"
import { thinkingArgs } from "../../thinking"
import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseOpencodeLine } from "./parser"
import { OPENCODE_TOOL_MAPPINGS } from "./tools"
import { quote } from "../../utils/shell"
import { buildOpencodeInvocationEnv } from "./config"

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
    // Unmarked files have no ownership proof, even if an older app wrote them.
    // Native OpenCode precedence must keep project/global user config intact.
  },

  buildCommand(options: RunOptions): CommandSpec {
    // A native merge into a provider named `custom` could inherit unrelated
    // credentials/headers from user config. Use a fresh native provider identity;
    // the application's stable custom/<model> identity remains unchanged.
    const customProviderId = options.env?.CUSTOM_OPENCODE_BASE_URL
      ? `backgrounder-custom-${randomUUID()}` : undefined
    const model = customProviderId && options.model?.startsWith("custom/")
      ? `${customProviderId}/${options.model.slice("custom/".length)}`
      : options.model
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
      ...thinkingArgs("opencode", options.model, options.thinking).map(quote),
    ]

    if (model) {
      parts.push("-m", quote(model))
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
    const env = buildOpencodeInvocationEnv(options.env ?? {}, customProviderId)

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
