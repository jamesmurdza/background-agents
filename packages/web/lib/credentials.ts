/**
 * Credential field metadata + storage migration shim.
 *
 * The shape itself (CredentialId / CredentialFlags / Credentials) lives in
 * @upstream/common — this module just adds simple-chat's UI metadata for
 * each credential field and the on-read normalization for legacy DB rows.
 *
 * NOTE: This file is safe for client-side imports. Server-only logic
 * (getEffectiveCredentialFlags) lives in lib/server/credential-flags.ts.
 */

import {
  type CredentialId,
  type CredentialFlags,
  type Credentials,
  type ProviderId,
} from "@upstream/common"

export type { CredentialId, CredentialFlags, Credentials, ProviderId }

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
    id: "KILO_API_KEY",
    provider: "kilo",
    label: "Kilo",
    helpUrl: "https://app.kilo.ai",
    placeholder: "kilo-...",
  },
  {
    id: "GEMINI_API_KEY",
    provider: "gemini",
    label: "Google AI (Gemini)",
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "NOUS_API_KEY",
    provider: "nous",
    label: "Nous Portal",
    helpUrl: "https://portal.nousresearch.com",
    placeholder: "nous-...",
    description: "Hermes agent: highest priority. Gives access to Nous-hosted models.",
  },
  {
    id: "OPENROUTER_API_KEY",
    provider: "openrouter",
    label: "OpenRouter",
    helpUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
    description: "Hermes agent: used when no Nous Portal key is set. Access to 200+ models.",
  },
] as const

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
  nousApiKey: "NOUS_API_KEY",
  openrouterApiKey: "OPENROUTER_API_KEY",
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
