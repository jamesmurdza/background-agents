/**
 * Custom endpoint header parsing and per-runtime env var construction.
 *
 * Users configure custom endpoints (BYO base URL + model + auth headers) in
 * settings; this module turns a stored CustomEndpoint into the env vars each
 * runtime (Claude Code / Codex / OpenCode) expects. Split out of agents.ts to
 * keep that file focused on agent/model resolution — these functions have no
 * dependency on the agent/model catalog beyond the CustomEndpoint type.
 */

import type { CustomEndpoint } from "./agents"

export interface ParsedCustomHeaders {
  /** Value of an `x-api-key:` line, mapped to ANTHROPIC_API_KEY. */
  apiKey?: string
  /** Value of an `Authorization:` line (any `Bearer ` prefix stripped), mapped to ANTHROPIC_AUTH_TOKEN. */
  authToken?: string
  /** The remaining (non-auth) headers as a cleaned blob, or undefined if none. */
  headers?: string
}

/**
 * Parse a single `Name: Value` header line into its (case-folded) name, the
 * original-cased name, and the trimmed value. Returns null for blank lines or
 * lines without a `name:` prefix.
 */
function parseHeaderLine(line: string): { name: string; rawName: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf(":")
  if (idx <= 0) return null // no name, or no colon
  const rawName = trimmed.slice(0, idx).trim()
  return { name: rawName.toLowerCase(), rawName, value: trimmed.slice(idx + 1).trim() }
}

/**
 * Parse a user-supplied custom-headers blob (newline-separated `Name: Value`
 * pairs). Auth headers are promoted to the canonical env vars the Claude CLI
 * understands so the run actually authenticates (and the CLI starts):
 *   `x-api-key: …`      → apiKey   (→ ANTHROPIC_API_KEY)
 *   `Authorization: …`  → authToken (→ ANTHROPIC_AUTH_TOKEN, `Bearer ` stripped)
 * `anthropic-version` is dropped (the CLI manages it). Everything else passes
 * through as additional request headers. Malformed/empty lines are ignored.
 */
export function parseCustomHeaders(raw: string): ParsedCustomHeaders {
  let apiKey: string | undefined
  let authToken: string | undefined
  const kept: string[] = []
  for (const line of raw.split("\n")) {
    const parsed = parseHeaderLine(line)
    if (!parsed) continue
    const { name, rawName, value } = parsed
    if (!value) continue
    if (name === "x-api-key") {
      apiKey = value
    } else if (name === "authorization") {
      authToken = value.replace(/^Bearer\s+/i, "")
    } else if (name === "anthropic-version") {
      // Managed by the CLI — ignore.
    } else {
      kept.push(`${rawName}: ${value}`)
    }
  }
  return { apiKey, authToken, headers: kept.length > 0 ? kept.join("\n") : undefined }
}

/** Build the env vars for a selected custom endpoint, dispatching on its type. */
export function buildEndpointEnv(endpoint: CustomEndpoint): Record<string, string> {
  switch (endpoint.type) {
    case "anthropic":
      return buildCustomModelEnv(endpoint)
    case "codex":
      return buildCodexCustomEnv(endpoint)
    case "opencode":
      return buildOpencodeCustomEnv(endpoint)
  }
}

/**
 * Map an Anthropic-type endpoint to the standard Anthropic env vars the Claude
 * CLI understands:
 *   baseUrl → ANTHROPIC_BASE_URL
 *   headers → ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (auth headers, promoted)
 *             + ANTHROPIC_CUSTOM_HEADERS (the rest)
 * The model is applied separately as the CLI --model arg (resolveCliModel).
 * Deliberately never includes CLAUDE_CODE_CREDENTIALS, so a custom run can never
 * leak the shared-pool token.
 */
export function buildCustomModelEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.ANTHROPIC_BASE_URL = endpoint.baseUrl
  if (endpoint.headers) {
    const { apiKey, authToken, headers } = parseCustomHeaders(endpoint.headers)
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken
    if (headers) env.ANTHROPIC_CUSTOM_HEADERS = headers
  }
  return env
}

/** Return the verbatim value of a named header from a `Name: Value` blob. */
function extractHeaderValue(raw: string, headerName: string): string | undefined {
  const target = headerName.toLowerCase()
  for (const line of raw.split("\n")) {
    if (line.trim().startsWith("#")) continue // comment line
    const parsed = parseHeaderLine(line)
    if (!parsed) continue
    if (parsed.name === target) return parsed.value || undefined
  }
  return undefined
}

/**
 * Pass the stored CUSTOM_CODEX_* credentials through to the sandbox. The Codex
 * CLI takes a custom endpoint via ~/.codex/config.toml rather than env vars, so
 * the SDK's codexSetup reads these back and generates the config file — see
 * buildCodexConfigToml in the SDK.
 *
 * Auth handling: Codex drops the Authorization header for a custom base_url when
 * it's supplied via `env_key` or a static http_header (the header is lost on the
 * transport fallback — see openai/codex#15492). The path that survives is
 * `env_http_headers`, which injects a header from a named env var. So we copy the
 * user's *full* `Authorization` value (incl. the `Bearer ` prefix, verbatim) into
 * a CUSTOM_CODEX_AUTHORIZATION env var; the generated config maps the
 * Authorization header to it via env_http_headers. The raw blob still rides along
 * for any non-auth headers.
 *
 * Deliberately never includes OPENAI_API_KEY, so a custom Codex run can't fall
 * back to a stored OpenAI key.
 */
export function buildCodexCustomEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.CUSTOM_CODEX_BASE_URL = endpoint.baseUrl
  if (endpoint.model) env.CUSTOM_CODEX_NAME = endpoint.model
  if (endpoint.headers) {
    env.CUSTOM_CODEX_HEADERS = endpoint.headers
    const authorization = extractHeaderValue(endpoint.headers, "Authorization")
    if (authorization) env.CUSTOM_CODEX_AUTHORIZATION = authorization
  }
  return env
}

/**
 * Pass the stored CUSTOM_OPENCODE_* credentials through to the sandbox. OpenCode
 * takes a custom provider via ~/.config/opencode/opencode.json, so the SDK's
 * opencodeSetup reads these back and writes that file — see buildOpencodeConfigJson.
 *
 * Auth: OpenCode's openai-compatible provider sends `Authorization: Bearer
 * <apiKey>`, so we promote the user's Authorization token (Bearer stripped) into
 * CUSTOM_OPENCODE_API_KEY, which the config references via `{env:...}`. Other
 * headers (incl. x-api-key) ride along in the blob for the SDK to emit verbatim.
 *
 * Deliberately never includes OPENCODE_API_KEY, so a custom run can't fall back
 * to a stored OpenCode key.
 */
export function buildOpencodeCustomEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.CUSTOM_OPENCODE_BASE_URL = endpoint.baseUrl
  if (endpoint.model) env.CUSTOM_OPENCODE_NAME = endpoint.model
  if (endpoint.headers) {
    env.CUSTOM_OPENCODE_HEADERS = endpoint.headers
    const { authToken } = parseCustomHeaders(endpoint.headers)
    if (authToken) env.CUSTOM_OPENCODE_API_KEY = authToken
  }
  return env
}
