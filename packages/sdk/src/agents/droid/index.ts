/**
 * Droid (Factory) CLI Agent Definition — BYOK
 *
 * Factory's `droid` is a Claude-Code-shaped CLI: `droid exec` runs headless and
 * supports `--output-format stream-json`, `-s <session>`, and `--auto <level>`.
 *
 * We drive it purely BYOK: droid runs on the user's OWN Anthropic/OpenAI/Gemini
 * key and needs NO Factory account or login
 * (https://docs.factory.ai/cli/byok/overview). Model selection (verified live
 * against droid v0.164):
 *
 *  - We declare the selected model as a single `customModels[]` entry in
 *    ~/.factory/settings.json under a fixed `custom:` id (`custom:byok-0`).
 *  - We select it with `droid exec -m custom:byok-0`. droid then hits the user's
 *    own provider endpoint with their key. Passing the RAW upstream model id (or
 *    omitting `-m`) instead makes droid fall back to its built-in default
 *    `claude-opus-4-8` — so the `custom:` id is required. (We also mirror it into
 *    `sessionDefaultSettings.model` as the session's default model.)
 *
 * The settings file is written fresh on every run (in the buildCommand shell)
 * because the chosen model changes per run. `apiKey` is a `${ENV_VAR}` reference
 * droid resolves from the process env, so no secret is ever written to disk.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseDroidLine } from "./parser"
import { DROID_TOOL_MAPPINGS } from "./tools"
import { quote } from "../../utils/shell"

/** Factory config dir + settings file in the daytona user's home. */
const FACTORY_CONFIG_DIR = "$HOME/.factory"
const FACTORY_CONFIG_FILE = "$HOME/.factory/settings.json"

/** Stable id we assign the single BYOK custom model (see sessionDefaultSettings). */
const BYOK_MODEL_ID = "custom:byok-0"

type DroidProvider = "anthropic" | "openai" | "generic-chat-completion-api"

interface CustomModel {
  id: string
  index: number
  model: string
  displayName: string
  baseUrl: string
  apiKey: string
  provider: DroidProvider
  maxOutputTokens: number
}

/**
 * Map a selected model id to its BYOK provider config:
 *  - `claude*`  → Anthropic on the user's ANTHROPIC_API_KEY
 *  - `gemini*`  → Google's OpenAI-compatible endpoint on GEMINI_API_KEY, via
 *                 droid's `generic-chat-completion-api` provider
 *  - otherwise  → OpenAI (`gpt-*`, `o1`/`o3`, …) on OPENAI_API_KEY
 *
 * baseUrl rules matter to droid: the `anthropic` provider baseUrl must NOT end in
 * `/v1` (droid appends `/v1/messages`); `openai` / `generic-chat-completion-api`
 * baseUrls SHOULD point at the OpenAI-style root (droid appends
 * `/chat/completions`). Confirmed against Factory's BYOK docs / sample settings.
 */
function byokProvider(model: string): {
  provider: DroidProvider
  baseUrl: string
  apiKey: string
} {
  if (model.startsWith("claude")) {
    return {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "${ANTHROPIC_API_KEY}",
    }
  }
  if (model.startsWith("gemini")) {
    return {
      provider: "generic-chat-completion-api",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "${GEMINI_API_KEY}",
    }
  }
  return {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "${OPENAI_API_KEY}",
  }
}

/** Build the ~/.factory/settings.json contents for the selected BYOK model. */
function buildSettingsJson(model: string): string {
  const { provider, baseUrl, apiKey } = byokProvider(model)
  const customModel: CustomModel = {
    id: BYOK_MODEL_ID,
    index: 0,
    model,
    displayName: `${model} (BYOK)`,
    baseUrl,
    apiKey,
    provider,
    maxOutputTokens: 16384,
  }
  return JSON.stringify(
    {
      customModels: [customModel],
      // Selection is via `-m custom:byok-0`; this just sets it as the default too.
      sessionDefaultSettings: { model: BYOK_MODEL_ID },
    },
    null,
    2
  )
}

/**
 * Droid (Factory) CLI agent definition. Drives `droid exec`, which outputs
 * droid-native stream-json (see the parser).
 */
export const droidAgent: AgentDefinition = {
  name: "droid",

  toolMappings: DROID_TOOL_MAPPINGS,

  capabilities: {
    // droid exec has no --system-prompt flag we rely on here; use the synthetic
    // prefix. (droid does expose --append-system-prompt; wire it later if needed.)
    supportsSystemPrompt: false,
    // Resumable — but via `--fork`, not `-s` (see buildCommand).
    supportsResume: true,
    supportsPlanMode: false,
    // No setup(): settings.json depends on the per-run model, so it's written in
    // buildCommand's shell instead.
  },

  buildCommand(options: RunOptions): CommandSpec {
    // Select the BYOK model by its `custom:` id (verified against droid v0.164:
    // `droid exec -m custom:byok-0` routes to the customModels entry and the
    // user's own key). Passing the RAW upstream id (or omitting `-m`) instead
    // makes droid fall back to its built-in default `claude-opus-4-8`.
    const args: string[] = [
      "exec",
      "--output-format",
      "stream-json",
      "--auto",
      "high",
      "-m",
      BYOK_MODEL_ID,
    ]

    // Continue a prior turn by FORKING its session. droid's `-s`/--session-id
    // resume hard-crashes headless (exit 1, zero output — verified live on
    // v0.164), but `--fork <id>` works and carries the full prior context. A fork
    // mints a NEW session id (emitted on the next init line and captured by the
    // parser), so each turn forks from the latest id to chain the conversation.
    if (options.sessionId) {
      args.push("--fork", options.sessionId)
    }

    // Prompt is the positional query argument.
    if (options.prompt) {
      args.push(options.prompt)
    }

    const droidCmd = ["droid", ...args].map(quote).join(" ")

    // Write settings.json for the selected BYOK model, then run droid. A quoted
    // heredoc ('DROID_EOF') keeps the shell from expanding the ${ANTHROPIC_API_KEY}
    // / ${OPENAI_API_KEY} refs — droid resolves those itself at runtime.
    const settingsJson = buildSettingsJson(options.model ?? "claude-sonnet-4-5-20250929")
    const script = [
      `export PATH="$HOME/.local/bin:$PATH"`,
      `mkdir -p "${FACTORY_CONFIG_DIR}"`,
      `cat > "${FACTORY_CONFIG_FILE}" <<'DROID_EOF'\n${settingsJson}\nDROID_EOF`,
      `chmod 600 "${FACTORY_CONFIG_FILE}"`,
      droidCmd,
    ].join("\n")

    return {
      cmd: "bash",
      args: ["-c", script],
      env: { ...options.env },
    }
  },

  parse(line: string, _context: ParseContext): Event | Event[] | null {
    return parseDroidLine(line, this.toolMappings)
  },
}
