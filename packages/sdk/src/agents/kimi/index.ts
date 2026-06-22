/**
 * Kimi Code CLI Agent Definition
 *
 * Kimi Code (Moonshot AI) is a Claude-Code-shaped CLI: it supports headless
 * `-p` runs, `--output-format stream-json`, `-m <model>`, and `--session <id>`.
 *
 * Unlike the other agents, Kimi does NOT read API keys from the shell
 * environment automatically — it only reads credentials from
 * ~/.kimi-code/config.toml. We therefore write a small static config in setup()
 * that declares a Moonshot ("kimi") provider whose api_key is sourced from the
 * KIMI_API_KEY environment variable (the [providers.kimi.env] sub-table). The
 * key itself is still injected as an env var like every other provider, so the
 * secret never lands in a file.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { CodeAgentSandbox } from "../../types/provider"
import type { Event } from "../../types/events"
import { parseKimiLine } from "./parser"
import { KIMI_TOOL_MAPPINGS } from "./tools"
import { quote } from "../../utils/shell"

/** Kimi config directory (daytona user home) */
const KIMI_CONFIG_DIR = "/home/daytona/.kimi-code"
/** Kimi config file */
const KIMI_CONFIG_FILE = "/home/daytona/.kimi-code/config.toml"
/** Default Moonshot API base URL */
const KIMI_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1"

/**
 * Moonshot models exposed to Kimi Code. Each must be declared in config.toml
 * with a max_context_size or the CLI refuses to use it. ids match the Moonshot
 * /v1/models catalog and the values in agentModels.kimi (@background-agents/common).
 */
const KIMI_MODELS: { id: string; context: number }[] = [
  { id: "kimi-k2.7-code", context: 262144 },
  { id: "kimi-k2.7-code-highspeed", context: 262144 },
  { id: "kimi-k2.6", context: 262144 },
  { id: "kimi-k2.5", context: 262144 },
]
/** Default model — must be one of KIMI_MODELS. */
const KIMI_DEFAULT_MODEL = "kimi-k2.7-code"

/**
 * config.toml that wires a Moonshot ("kimi") provider reading its API key from
 * the KIMI_API_KEY environment variable (the [providers.kimi.env] sub-table),
 * plus a [models."<id>"] entry per exposed model. Static (no secret) — safe to
 * write verbatim into the sandbox.
 */
const KIMI_CONFIG_TOML = `default_model = "${KIMI_DEFAULT_MODEL}"

[providers.kimi]
type = "kimi"
base_url = "${KIMI_DEFAULT_BASE_URL}"

[providers.kimi.env]
api_key = "KIMI_API_KEY"
${KIMI_MODELS.map(
  (m) => `
[models."${m.id}"]
provider = "kimi"
model = "${m.id}"
max_context_size = ${m.context}`
).join("\n")}
`

/**
 * Kimi agent-specific setup: write ~/.kimi-code/config.toml so the CLI knows to
 * read its credentials from the injected KIMI_API_KEY env var.
 */
async function kimiSetup(
  sandbox: CodeAgentSandbox,
  _env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  // Write the config via a heredoc to avoid shell-escaping the TOML body.
  await sandbox.executeCommand(
    `mkdir -p '${KIMI_CONFIG_DIR}' && cat > '${KIMI_CONFIG_FILE}' <<'KIMI_EOF'\n${KIMI_CONFIG_TOML}KIMI_EOF\nchmod 600 '${KIMI_CONFIG_FILE}'`,
    30
  )
}

/**
 * Kimi Code CLI agent definition.
 *
 * Interacts with the Kimi CLI, which outputs JSON lines in stream-json format
 * (same shape as Claude Code).
 */
export const kimiAgent: AgentDefinition = {
  name: "kimi",

  toolMappings: KIMI_TOOL_MAPPINGS,

  capabilities: {
    // Kimi has no --system-prompt flag; rely on the synthetic prefix instead.
    supportsSystemPrompt: false,
    supportsResume: true,
    supportsPlanMode: false,
    setup: kimiSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Note: prompt mode (-p) runs non-interactively and auto-approves actions on
    // its own — the CLI rejects both --yolo and --auto when combined with -p.

    // Model alias (e.g. "kimi/kimi-k2-0905-preview")
    if (options.model) {
      args.push("-m", options.model)
    }

    // Resume a specific session
    if (options.sessionId) {
      args.push("-S", options.sessionId)
    }

    // Stream JSON output for prompt mode
    args.push("--output-format", "stream-json")

    // Prompt is the VALUE of -p / --prompt (not a positional arg)
    if (options.prompt) {
      args.push("-p", options.prompt)
    }

    // Kimi's installer drops the binary at ~/.kimi-code/bin/kimi and only adds
    // it to ~/.profile, which the job runner's non-interactive shell may not
    // source — wrap in bash and prepend the dir explicitly.
    const kimiCmd = ["kimi", ...args].map(quote).join(" ")

    return {
      cmd: "bash",
      args: ["-c", `export PATH="$HOME/.kimi-code/bin:$PATH" && ${kimiCmd}`],
      env: { ...options.env },
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseKimiLine(line, this.toolMappings)
  },
}
