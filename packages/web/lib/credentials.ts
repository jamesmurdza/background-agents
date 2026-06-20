/**
 * Credential field metadata + storage migration shim.
 *
 * The shape itself (CredentialId / CredentialFlags / Credentials) lives in
 * @background-agents/common — this module just adds simple-chat's UI metadata for
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
} from "@background-agents/common"

export type { CredentialId, CredentialFlags, Credentials, ProviderId }

export interface CredentialField {
  id: CredentialId
  provider: ProviderId
  label: string
  helpUrl?: string
  placeholder?: string
  multiline?: boolean
  description?: string
  /** Marks a field the user must fill in. Rendered with a required indicator. */
  required?: boolean
  /**
   * Which settings tab renders this field. Defaults to "api-keys". Fields in a
   * "custom-*" group are rendered on the Custom model tab (each group is a target
   * in its selector) and filtered out of the API Keys tab.
   */
  group?: "api-keys" | "custom-model" | "custom-codex" | "custom-opencode"
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
    id: "COPILOT_GITHUB_TOKEN",
    provider: "github",
    label: "GitHub PAT (Copilot)",
    helpUrl: "https://github.com/settings/personal-access-tokens/new",
    placeholder: "github_pat_...",
    description: "Fine-grained PAT with Copilot Requests permission.",
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
    id: "KIMI_API_KEY",
    provider: "kimi",
    label: "Kimi (Moonshot)",
    helpUrl: "https://platform.moonshot.ai/console/api-keys",
    placeholder: "sk-...",
  },
  {
    id: "GEMINI_API_KEY",
    provider: "gemini",
    label: "Google AI (Gemini)",
    helpUrl: "https://aistudio.google.com/apikey",
  },
  // Custom Anthropic-compatible endpoint — rendered on the "Custom model" tab.
  // Required field comes first; auth is supplied through the headers field.
  {
    id: "CUSTOM_MODEL_BASE_URL",
    provider: "anthropic",
    label: "Base URL",
    placeholder: "https://api.anthropic.com",
    required: true,
    group: "custom-model",
  },
  {
    id: "CUSTOM_MODEL_NAME",
    provider: "anthropic",
    label: "Model ID",
    placeholder: "claude-opus-4-1 (sent to --model)",
    description: "The exact model ID the endpoint expects. Leave blank to use its default.",
    group: "custom-model",
  },
  {
    id: "CUSTOM_MODEL_HEADERS",
    provider: "anthropic",
    label: "Headers",
    multiline: true,
    placeholder: "x-api-key: sk-ant-…\n# or: Authorization: Bearer <token>",
    description:
      "One per line — Header-Name: value. Put auth here: x-api-key or Authorization. anthropic-version is managed for you.",
    group: "custom-model",
  },
  // Custom OpenAI-compatible endpoint for Codex — the "Codex" target on the
  // Custom model tab. Mirrors the Anthropic custom-model fields: Base URL is
  // required, auth is supplied through the Headers field rather than a separate key.
  {
    id: "CUSTOM_CODEX_BASE_URL",
    provider: "openai",
    label: "Base URL",
    placeholder: "https://api.openai.com/v1",
    required: true,
    group: "custom-codex",
  },
  {
    id: "CUSTOM_CODEX_NAME",
    provider: "openai",
    label: "Model ID",
    placeholder: "gpt-5.5 (sent to --model)",
    description: "The exact model ID the endpoint expects. Leave blank to use its default.",
    group: "custom-codex",
  },
  {
    id: "CUSTOM_CODEX_HEADERS",
    provider: "openai",
    label: "Headers",
    multiline: true,
    placeholder: "Authorization: Bearer sk-…\n# or: x-api-key: <token>",
    description:
      "One per line — Header-Name: value. Put auth here (e.g. Authorization: Bearer …); it's sent with every request.",
    group: "custom-codex",
  },
  // Custom OpenAI-compatible endpoint for OpenCode — the "OpenCode" target on the
  // Custom model tab. Model ID is required (OpenCode addresses models as
  // <provider>/<model>); auth is supplied through the Headers field.
  {
    id: "CUSTOM_OPENCODE_BASE_URL",
    provider: "openai",
    label: "Base URL",
    placeholder: "https://openrouter.ai/api/v1",
    required: true,
    group: "custom-opencode",
  },
  {
    id: "CUSTOM_OPENCODE_NAME",
    provider: "openai",
    label: "Model ID",
    placeholder: "gpt-4o-mini",
    description: "The exact model ID the endpoint expects. Required for OpenCode.",
    required: true,
    group: "custom-opencode",
  },
  {
    id: "CUSTOM_OPENCODE_HEADERS",
    provider: "openai",
    label: "Headers",
    multiline: true,
    placeholder: "Authorization: Bearer sk-…\n# or: x-api-key: <token>",
    description:
      "One per line — Header-Name: value. Put auth here (e.g. Authorization: Bearer …); it's sent with every request.",
    group: "custom-opencode",
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
