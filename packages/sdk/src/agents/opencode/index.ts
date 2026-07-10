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
import {
  buildOpencodeProvider,
  OPENCODE_CONFIG_SCHEMA,
} from "./config"

/**
 * Global OpenCode config path — NOT the project root. Writing under the repo
 * checkout would dirty the sandbox working tree (and could get committed by the
 * agent). The MCP setup (see @background-agents/agent-configuration) writes the
 * `mcp` section into this same file, so both readers/writers here preserve keys
 * they don't own.
 */
const OPENCODE_CONFIG_DIR = "~/.config/opencode"
const OPENCODE_CONFIG_PATH = `${OPENCODE_CONFIG_DIR}/opencode.json`

/**
 * Legacy location that older builds wrote OpenCode config to — the repo checkout
 * itself. Sandboxes created before the global-path fix still have this file
 * sitting in the working tree, where it dirties `git status` and can be swept
 * into the agent's commit. On every session start we relocate it (see
 * relocateLegacyProjectConfig) so existing sandboxes self-heal.
 */
const OPENCODE_LEGACY_PROJECT_CONFIG_PATH = "/home/daytona/project/opencode.json"

/** Read+parse the global opencode.json, or `{}` if absent/unparseable. */
async function readOpencodeConfig(
  sandbox: CodeAgentSandbox
): Promise<Record<string, unknown>> {
  const res = await sandbox.executeCommand!(
    `cat ${OPENCODE_CONFIG_PATH} 2>/dev/null || echo '{}'`,
    10
  )
  try {
    return JSON.parse((res?.output ?? "").trim() || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Migrate a stale project-root opencode.json (written by older builds) out of
 * the repo working tree. Folds any keys the global config doesn't already own
 * into `config` (global wins, since it reflects this run's setupMcpForAgent),
 * then deletes the project-root file so it stops dirtying the tree. Returns
 * whether `config` gained anything and therefore needs to be written back.
 */
async function relocateLegacyProjectConfig(
  sandbox: CodeAgentSandbox,
  config: Record<string, unknown>
): Promise<boolean> {
  const res = await sandbox.executeCommand!(
    `cat ${OPENCODE_LEGACY_PROJECT_CONFIG_PATH} 2>/dev/null || true`,
    10
  )
  const raw = (res?.output ?? "").trim()
  if (!raw) return false

  // Remove it regardless of what it contains — we never want config in the tree.
  await sandbox.executeCommand!(`rm -f ${OPENCODE_LEGACY_PROJECT_CONFIG_PATH}`, 10)

  let legacy: Record<string, unknown>
  try {
    legacy = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return false // junk file: deleted, nothing worth salvaging
  }

  let changed = false
  for (const [key, value] of Object.entries(legacy)) {
    if (config[key] === undefined) {
      config[key] = value
      changed = true
    }
  }
  return changed
}

/** Write the global opencode.json (creating its directory). */
async function writeOpencodeConfig(
  sandbox: CodeAgentSandbox,
  config: Record<string, unknown>
): Promise<void> {
  const json = JSON.stringify(config, null, 2) + "\n"
  await sandbox.executeCommand!(
    `mkdir -p ${OPENCODE_CONFIG_DIR} && printf '%s' ${quote(json)} > ${OPENCODE_CONFIG_PATH}`,
    30
  )
}

/**
 * OpenCode agent-specific setup. Runs on every session start (for both fresh and
 * reused sandboxes), read-modify-writing the global opencode.json so the `mcp`
 * section written earlier by setupMcpForAgent survives:
 *
 * 0. Relocation — move any legacy project-root opencode.json out of the repo
 *    working tree and into the global config (self-heals older sandboxes).
 * 1. Custom endpoint — when CUSTOM_OPENCODE_BASE_URL is set, merge a custom
 *    OpenAI-compatible `provider` into the file. Auth lives in the headers blob
 *    (promoted to the provider apiKey).
 * 2. Standard — drop any `provider` left over from a previous custom run in this
 *    sandbox, so a custom→standard switch stops using the old provider, while
 *    keeping any MCP config in place.
 */
async function opencodeSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  const config = await readOpencodeConfig(sandbox)
  let dirty = await relocateLegacyProjectConfig(sandbox, config)

  if (env.CUSTOM_OPENCODE_BASE_URL) {
    config.$schema = config.$schema ?? OPENCODE_CONFIG_SCHEMA
    config.provider = buildOpencodeProvider({
      baseUrl: env.CUSTOM_OPENCODE_BASE_URL,
      model: env.CUSTOM_OPENCODE_NAME || "",
      headers: env.CUSTOM_OPENCODE_HEADERS || undefined,
      apiKeyEnv: env.CUSTOM_OPENCODE_API_KEY ? "CUSTOM_OPENCODE_API_KEY" : undefined,
    })
    dirty = true
  } else if (config.provider !== undefined) {
    // Standard path: strip a leftover custom provider from a previous run.
    delete config.provider
    dirty = true
  }

  if (dirty) await writeOpencodeConfig(sandbox, config)
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
