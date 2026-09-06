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

import { parseCodexCredential } from "@/lib/codex-credentials"
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
  /**
   * Server-written credentials. These are never rendered as a text input and
   * never accepted from a client write — they're established by an OAuth flow
   * and refreshed by the server.
   */
  serverManaged?: boolean
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
    id: "CODEX_CREDENTIALS",
    provider: "openai",
    label: "ChatGPT Subscription",
    description: "Codex only. Connected by signing in, not by pasting a value.",
    serverManaged: true,
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
    id: "FACTORY_API_KEY",
    provider: "factory",
    label: "Factory (Droid)",
    helpUrl: "https://app.factory.ai/settings/api-keys",
    placeholder: "fk-...",
    description: "Optional. Droid runs BYOK on your Anthropic/OpenAI key — no Factory key needed. Only set this to route through Factory's hosted platform.",
  },
  {
    id: "GEMINI_API_KEY",
    provider: "gemini",
    label: "Google AI (Gemini)",
    helpUrl: "https://aistudio.google.com/apikey",
  },
] as const

const CREDENTIAL_IDS = new Set<string>(CREDENTIAL_KEYS.map((c) => c.id))

export function isCredentialId(value: string): value is CredentialId {
  return CREDENTIAL_IDS.has(value)
}

const SERVER_MANAGED_IDS = new Set<string>(
  CREDENTIAL_KEYS.filter((c) => c.serverManaged).map((c) => c.id)
)

/**
 * Whether a credential may be set by a client PATCH. Server-managed
 * credentials (the Codex ChatGPT subscription) are established by an OAuth
 * flow and rotated by the server; accepting a pasted value would both corrupt
 * the stored shape and reintroduce the shared-token-lineage problem the OAuth
 * flow exists to avoid.
 */
export function isClientWritableCredential(id: CredentialId): boolean {
  return !SERVER_MANAGED_IDS.has(id)
}

/**
 * Presence flags per credential id.
 *
 * CODEX_CREDENTIALS is the one id where presence is NOT the right signal. Its
 * stored value is a JSON credential with a lifecycle: a grant OpenAI has
 * rejected is kept on the row marked `needs_reconnect` (deliberately — never
 * retried, never silently dropped) rather than deleted. Flagging that as
 * available makes hasCredentialsForModel unlock the Codex models for a user
 * whose subscription cannot actually serve a run, so they pick a model and get
 * an opaque agent-side failure instead of the "reconnect" prompt Settings is
 * ready to show them. Derive from the PARSED status instead: a value that does
 * not parse as a complete credential, or parses as `needs_reconnect`, is not a
 * usable subscription.
 *
 * Every other id keeps plain presence semantics.
 */
export function flagsFromCredentials(credentials: Credentials): CredentialFlags {
  const out: CredentialFlags = {}
  for (const { id } of CREDENTIAL_KEYS) {
    if (id === "CODEX_CREDENTIALS") {
      out[id] = parseCodexCredential(credentials[id])?.status === "connected"
      continue
    }
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
