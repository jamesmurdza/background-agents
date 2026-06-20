/**
 * Codex custom-endpoint config generation.
 *
 * The Codex CLI takes a custom model provider through ~/.codex/config.toml
 * (not env vars), so when the user configures a custom OpenAI-compatible
 * endpoint we synthesize that file. The stored CUSTOM_CODEX_* credentials are
 * passed into the sandbox as env vars (see buildCodexCustomEnv in
 * @background-agents/common); codexSetup reads them back and writes the config.
 */

import { parseHeaderLines } from "../../utils/headers"

export interface CodexCustomConfig {
  /** Provider base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string
  /** Model id written as the default `model`; usually also passed via --model. */
  model?: string
  /** Raw Headers blob from the UI (newline-separated `Name: Value` pairs). */
  headers?: string
  /**
   * Name of the env var holding the full `Authorization` value (e.g.
   * "Bearer sk-..."). Mapped to the Authorization header via `env_http_headers`.
   * This is the only auth path that survives Codex's transport fallback for a
   * custom base_url — `env_key` and static http_headers both drop the header
   * (openai/codex#15492). The Authorization line is therefore omitted from
   * static http_headers.
   */
  authHeaderEnv?: string
}

/** Provider id used for the synthesized custom provider in config.toml. */
const CODEX_CUSTOM_PROVIDER_ID = "custom"

/** Escape a string for use inside a TOML basic (double-quoted) string. */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
  return `"${escaped}"`
}

/**
 * Build a ~/.codex/config.toml that routes all requests through a custom
 * provider. The Authorization header (if any) is routed via env_http_headers;
 * other headers are emitted as static http_headers.
 *
 * `wire_api` is "responses" (the OpenAI Responses API): current Codex CLI
 * versions have removed Chat Completions support and reject `wire_api = "chat"`
 * outright (see https://github.com/openai/codex/discussions/7782). The custom
 * endpoint must therefore implement the OpenAI Responses API — a Chat-Completions
 * -only gateway (incl. Anthropic's OpenAI-compatibility layer) won't work.
 */
export function buildCodexConfigToml(cfg: CodexCustomConfig): string {
  const id = CODEX_CUSTOM_PROVIDER_ID
  const lines: string[] = []

  lines.push(`model_provider = ${tomlString(id)}`)
  if (cfg.model) lines.push(`model = ${tomlString(cfg.model)}`)
  lines.push("")
  lines.push(`[model_providers.${id}]`)
  lines.push(`name = ${tomlString("Custom")}`)
  lines.push(`base_url = ${tomlString(cfg.baseUrl)}`)
  lines.push(`wire_api = ${tomlString("responses")}`)

  // Non-auth headers go in static http_headers. The Authorization header is
  // routed through env_http_headers (below) instead — see authHeaderEnv.
  const staticHeaders = parseHeaderLines(cfg.headers ?? "").filter(
    ([name]) => name.toLowerCase() !== "authorization"
  )
  if (staticHeaders.length > 0) {
    lines.push("")
    lines.push(`[model_providers.${id}.http_headers]`)
    for (const [name, value] of staticHeaders) {
      lines.push(`${tomlString(name)} = ${tomlString(value)}`)
    }
  }

  // Authorization via env_http_headers — the only path that survives the
  // custom-base_url transport fallback (openai/codex#15492). The env var holds
  // the full value (e.g. "Bearer sk-...") and Codex sends it verbatim.
  if (cfg.authHeaderEnv) {
    lines.push("")
    lines.push(`[model_providers.${id}.env_http_headers]`)
    lines.push(`${tomlString("Authorization")} = ${tomlString(cfg.authHeaderEnv)}`)
  }

  return lines.join("\n") + "\n"
}
