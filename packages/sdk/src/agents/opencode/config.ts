/**
 * OpenCode custom-endpoint config generation.
 *
 * OpenCode takes a custom model provider through ~/.config/opencode/opencode.json
 * (built on the Vercel AI SDK), so when the user configures a custom
 * OpenAI-compatible endpoint we synthesize that file. The stored CUSTOM_OPENCODE_*
 * credentials are passed into the sandbox as env vars (see buildOpencodeCustomEnv
 * in @background-agents/common); opencodeSetup reads them back and writes this file.
 */

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

/**
 * Build a ~/.config/opencode/opencode.json that routes the custom model through
 * an OpenAI-compatible provider (`@ai-sdk/openai-compatible`). The Authorization
 * header is supplied as `options.apiKey` via `{env:...}`; any other headers pass
 * through as `options.headers`.
 */
export function buildOpencodeConfigJson(cfg: OpencodeCustomConfig): string {
  const id = OPENCODE_CUSTOM_PROVIDER_ID

  const options: Record<string, unknown> = { baseURL: cfg.baseUrl }
  if (cfg.apiKeyEnv) options.apiKey = `{env:${cfg.apiKeyEnv}}`

  // Non-auth headers → options.headers. Authorization is carried by apiKey above.
  const headerPairs = parseHeaderLines(cfg.headers ?? "").filter(
    ([name]) => name.toLowerCase() !== "authorization"
  )
  if (headerPairs.length > 0) {
    options.headers = Object.fromEntries(headerPairs)
  }

  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [id]: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom",
        options,
        models: { [cfg.model]: { name: cfg.model } },
      },
    },
  }

  return JSON.stringify(config, null, 2) + "\n"
}
