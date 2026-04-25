/**
 * Credentials — single source of truth for the API keys we accept.
 *
 * Identifiers double as the env-var name we inject into the agent process,
 * so storage, sync, and runtime injection all share one shape:
 * `Partial<Record<CredentialId, string>>`.
 */

import type { Agent, UserCredentialFlags } from "@upstream/common"

export type CredentialId =
  | "ANTHROPIC_API_KEY"
  | "CLAUDE_CODE_CREDENTIALS"
  | "OPENAI_API_KEY"
  | "OPENCODE_API_KEY"
  | "GEMINI_API_KEY"

export type ProviderId = "anthropic" | "openai" | "opencode" | "gemini"

export interface CredentialField {
  id: CredentialId
  provider: ProviderId
  label: string
  helpUrl?: string
  placeholder?: string
  multiline?: boolean
  description?: string
}

export const CREDENTIAL_KEYS: readonly CredentialField[] = [
  {
    id: "ANTHROPIC_API_KEY",
    provider: "anthropic",
    label: "Anthropic",
    helpUrl: "https://console.anthropic.com/",
    placeholder: "sk-ant-...",
  },
  {
    id: "CLAUDE_CODE_CREDENTIALS",
    provider: "anthropic",
    label: "Claude Subscription",
    multiline: true,
    placeholder: '{"claudeAiOauth":{"token_type":"bearer",...}}',
    description: "Claude Code only.",
  },
  {
    id: "OPENAI_API_KEY",
    provider: "openai",
    label: "OpenAI",
    helpUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
  },
  {
    id: "OPENCODE_API_KEY",
    provider: "opencode",
    label: "OpenCode",
    helpUrl: "https://opencode.ai/auth",
  },
  {
    id: "GEMINI_API_KEY",
    provider: "gemini",
    label: "Google AI (Gemini)",
    helpUrl: "https://aistudio.google.com/apikey",
  },
] as const

export type Credentials = Partial<Record<CredentialId, string>>
export type CredentialFlags = Partial<Record<CredentialId, boolean>>

const CREDENTIAL_IDS = new Set<string>(CREDENTIAL_KEYS.map((c) => c.id))

export function isCredentialId(value: string): value is CredentialId {
  return CREDENTIAL_IDS.has(value)
}

export function flagsFromCredentials(credentials: Credentials): CredentialFlags {
  const out: CredentialFlags = {}
  for (const { id } of CREDENTIAL_KEYS) {
    out[id] = !!credentials[id]
  }
  return out
}

/** Bridge to common's UserCredentialFlags, consumed by hasCredentialsForModel. */
export function toLegacyFlags(
  flags: CredentialFlags | null | undefined
): UserCredentialFlags {
  return {
    hasAnthropicApiKey: !!flags?.ANTHROPIC_API_KEY,
    hasAnthropicAuthToken: !!flags?.CLAUDE_CODE_CREDENTIALS,
    hasOpenaiApiKey: !!flags?.OPENAI_API_KEY,
    hasOpencodeApiKey: !!flags?.OPENCODE_API_KEY,
    hasGeminiApiKey: !!flags?.GEMINI_API_KEY,
  }
}

/**
 * Pick env vars to inject for a given agent+model.
 * The map keys ARE the env var names, so this is just a relevance filter
 * (with two special cases: Claude Code prefers the subscription token, and
 * Gemini also exposes its key as GOOGLE_API_KEY).
 */
export function envForAgent(
  agent: Agent | undefined,
  model: string | undefined,
  credentials: Credentials
): Record<string, string> {
  const env: Record<string, string> = {}
  const set = (id: CredentialId) => {
    const v = credentials[id]
    if (v) env[id] = v
  }

  if (!agent || agent === "claude-code") {
    if (credentials.CLAUDE_CODE_CREDENTIALS) set("CLAUDE_CODE_CREDENTIALS")
    else set("ANTHROPIC_API_KEY")
    return env
  }

  if (agent === "codex") {
    set("OPENAI_API_KEY")
    return env
  }

  if (agent === "gemini") {
    set("GEMINI_API_KEY")
    if (env.GEMINI_API_KEY) env.GOOGLE_API_KEY = env.GEMINI_API_KEY
    return env
  }

  if (agent === "goose") {
    if (model?.includes("claude")) set("ANTHROPIC_API_KEY")
    else set("OPENAI_API_KEY")
    return env
  }

  if (agent === "pi") {
    const prefix = model?.split("/")[0]
    if (prefix === "openai") set("OPENAI_API_KEY")
    else if (prefix === "google") set("GEMINI_API_KEY")
    else set("ANTHROPIC_API_KEY")
    return env
  }

  if (agent === "eliza") return env

  if (agent === "opencode") {
    const prefix = model?.split("/")[0]
    if (prefix === "anthropic") set("ANTHROPIC_API_KEY")
    else if (prefix === "openai") set("OPENAI_API_KEY")
    else if (prefix === "opencode") {
      const isFreeModel = model?.includes("-free") || model === "opencode/big-pickle"
      if (!isFreeModel) set("OPENCODE_API_KEY")
    }
    return env
  }

  return env
}

/**
 * Read a stored credentials JSON blob, accepting either the new env-var
 * keys or the legacy camelCase field names. Existing rows are upgraded
 * to the new shape on the next write.
 */
const LEGACY_KEY_MAP: Record<string, CredentialId> = {
  anthropicApiKey: "ANTHROPIC_API_KEY",
  anthropicAuthToken: "CLAUDE_CODE_CREDENTIALS",
  openaiApiKey: "OPENAI_API_KEY",
  opencodeApiKey: "OPENCODE_API_KEY",
  geminiApiKey: "GEMINI_API_KEY",
}

export function normalizeStoredCredentials(
  raw: Record<string, unknown> | null | undefined
): Record<CredentialId, string> {
  const out: Partial<Record<CredentialId, string>> = {}
  if (!raw) return out as Record<CredentialId, string>
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") continue
    if (isCredentialId(k)) {
      out[k] = v
    } else if (LEGACY_KEY_MAP[k]) {
      out[LEGACY_KEY_MAP[k]] = v
    }
  }
  return out as Record<CredentialId, string>
}
