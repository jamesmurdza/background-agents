/**
 * OpenCode custom-endpoint config generation.
 *
 * OpenCode accepts an invocation-local OPENCODE_CONFIG_CONTENT overlay, so a
 * custom endpoint need not rewrite global or repository config. CUSTOM_OPENCODE_*
 * credentials are passed into the sandbox as env vars (see buildOpencodeCustomEnv
 * in @background-agents/common); the command builder adds the native overlay.
 */

import { randomUUID } from "node:crypto"
import { parseHeaderLines } from "../../utils/headers"

export interface OpencodeCustomConfig {
  /** Provider base URL, e.g. https://openrouter.ai/api/v1 */
  baseUrl: string
  /** Model id the endpoint expects (e.g. "gpt-4o-mini"). Required — OpenCode
   *  addresses models as `<provider>/<model>`. */
  model: string
  /** Raw Headers blob from the UI (newline-separated `Name: Value` pairs). */
  headers?: string
  /**
   * Name of the env var holding the API key (Authorization token, Bearer
   * stripped). Referenced via `{env:...}` so the secret stays out of the file;
   * the openai-compatible provider sends it as `Authorization: Bearer <key>`.
   */
  apiKeyEnv?: string
}

/** Provider id used for the synthesized custom provider in opencode.json. */
export const OPENCODE_CUSTOM_PROVIDER_ID = "custom"

/** JSON `$schema` URL used by OpenCode config files. */
export const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json"

/**
 * Build the `provider` map that routes the custom model through an
 * OpenAI-compatible provider (`@ai-sdk/openai-compatible`). The Authorization
 * header is supplied as `options.apiKey` via `{env:...}`; any other headers pass
 * through as `options.headers`. Returned as a `{ [id]: {...} }` object so callers
 * can merge it into an existing opencode.json without clobbering other keys
 * (e.g. the `mcp` section).
 */
export function buildOpencodeProvider(
  cfg: OpencodeCustomConfig,
  id = OPENCODE_CUSTOM_PROVIDER_ID
): Record<string, unknown> {
  const options: Record<string, unknown> = { baseURL: cfg.baseUrl }
  if (cfg.apiKeyEnv) options.apiKey = `{env:${cfg.apiKeyEnv}}`

  // Non-auth headers → options.headers. Authorization is carried by apiKey above.
  const headerPairs = parseHeaderLines(cfg.headers ?? "").filter(
    ([name]) => name.toLowerCase() !== "authorization"
  )
  if (headerPairs.length > 0) {
    options.headers = Object.fromEntries(headerPairs)
  }

  return {
    [id]: {
      npm: "@ai-sdk/openai-compatible",
      name: "Custom",
      options,
      models: { [cfg.model]: { name: cfg.model } },
    },
  }
}

/**
 * Native inline config has higher precedence than global/project config. Scope
 * our explicitly selected custom endpoint to one command; OpenCode combines it
 * with disk config itself. Never infer ownership from a `custom` provider name.
 */
export function buildOpencodeInvocationEnv(
  env: Record<string, string>,
  providerId = `backgrounder-custom-${randomUUID()}`
): Record<string, string> {
  if (!env.CUSTOM_OPENCODE_BASE_URL) return { ...env }

  let config: Record<string, unknown> = {}
  if (env.OPENCODE_CONFIG_CONTENT?.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
    } catch {
      // Do not include raw config: it may contain credentials.
      throw new Error("Cannot configure the custom OpenCode endpoint: OPENCODE_CONFIG_CONTENT must be a JSON object.")
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Cannot configure the custom OpenCode endpoint: OPENCODE_CONFIG_CONTENT must be a JSON object.")
    }
    config = parsed as Record<string, unknown>
  }
  if (config.provider !== undefined &&
      (config.provider === null || typeof config.provider !== "object" || Array.isArray(config.provider))) {
    throw new Error("Cannot configure the custom OpenCode endpoint: inline provider configuration must be an object.")
  }
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      $schema: config.$schema ?? OPENCODE_CONFIG_SCHEMA,
      provider: {
        ...config.provider as Record<string, unknown> | undefined,
        ...buildOpencodeProvider({
          baseUrl: env.CUSTOM_OPENCODE_BASE_URL,
          model: env.CUSTOM_OPENCODE_NAME || "",
          headers: env.CUSTOM_OPENCODE_HEADERS || undefined,
          apiKeyEnv: env.CUSTOM_OPENCODE_API_KEY ? "CUSTOM_OPENCODE_API_KEY" : undefined,
        }, providerId),
      },
    }),
  }
}

/**
 * Pure standalone config formatter, retained for callers/tests that need a full
 * document. The adapter itself uses an invocation overlay instead of disk writes.
 */
export function buildOpencodeConfigJson(cfg: OpencodeCustomConfig): string {
  const config = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    provider: buildOpencodeProvider(cfg),
  }

  return JSON.stringify(config, null, 2) + "\n"
}
