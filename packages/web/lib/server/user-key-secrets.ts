/**
 * Users' own provider keys via Daytona secrets (server-only).
 *
 * Like a shared pool key (see lib/server/shared-pool-secrets), a user's own
 * API key can reach the agent only as a Daytona secret's placeholder: the
 * sandbox never holds the key, and the proxy swaps it in on HTTPS requests
 * to the provider's hosts. It is mounted for the duration of a turn, the
 * same as a pool key (see lib/server/turn-secrets).
 *
 * Each key gets its own secret, named after the key itself ({@link secretName}),
 * so a rotated key gets a new secret and nothing has to be stored to know
 * whether one is current. An old one simply ages out once nothing uses it
 * (the app-wide secret-cleanup sweep, see @background-agents/sandbox-secrets'
 * `deleteStaleSecrets`).
 *
 * On unless DAYTONA_USER_KEY_SECRETS says otherwise ({@link userSecretsFlag}),
 * and only for the providers in {@link USER_KEY_PROVIDERS}. Copilot isn't one: its
 * CLI rejects anything that doesn't look like a GitHub token before sending
 * it. Subscriptions (Claude, Codex) aren't plain keys and keep their own
 * handling.
 */

import { Daytona } from "@daytonaio/sdk"
import { ensureSecret } from "@background-agents/sandbox-secrets"
import type { CredentialId } from "@background-agents/common"

export interface UserKeyProvider {
  /** Hosts the key may be sent to. */
  hosts: string[]
  /**
   * Env vars that point the CLI at another server. When the agent env sets
   * one (the user's chat/repo env vars), the key goes there instead of to
   * {@link hosts}, where the placeholder would be useless, so the run keeps
   * the raw key as before.
   */
  baseUrlEnv?: string[]
}

/** Providers verified to accept a placeholder and send it in a header. */
export const USER_KEY_PROVIDERS: Partial<Record<CredentialId, UserKeyProvider>> = {
  ANTHROPIC_API_KEY: { hosts: ["api.anthropic.com"], baseUrlEnv: ["ANTHROPIC_BASE_URL"] },
  OPENAI_API_KEY: { hosts: ["api.openai.com"], baseUrlEnv: ["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_HOST"] },
  GEMINI_API_KEY: {
    hosts: ["generativelanguage.googleapis.com"],
    baseUrlEnv: ["GOOGLE_GEMINI_BASE_URL", "GEMINI_BASE_URL"],
  },
  OPENCODE_API_KEY: { hosts: ["opencode.ai", "*.opencode.ai"] },
  KIMI_API_KEY: { hosts: ["api.moonshot.ai", "api.moonshot.cn", "api.kimi.com"] },
  KILO_API_KEY: { hosts: ["kilo.ai", "*.kilo.ai", "kilocode.ai", "*.kilocode.ai"] },
  FACTORY_API_KEY: { hosts: ["factory.ai", "*.factory.ai"] },
  COMMAND_CODE_API_KEY: { hosts: ["commandcode.ai", "*.commandcode.ai"] },
}

/**
 * Whether DAYTONA_USER_KEY_SECRETS turns on `entry` (a credential id,
 * CODEX_CREDENTIALS, CLAUDE_CODE_CREDENTIALS, CLAUDE_SHARED, OPENCODE_SHARED
 * or GEMINI_SHARED). Unset or
 * "all" turns on everything; otherwise only the comma-separated entries
 * listed ("none" lists none).
 */
export function userSecretsFlag(entry: string): boolean {
  const value = process.env.DAYTONA_USER_KEY_SECRETS
  if (value === undefined) return true
  const enabled = value.split(",").map((s) => s.trim())
  return enabled.includes("all") || enabled.includes(entry)
}

/** Whether `credential` is put behind a secret: it must have a provider entry and be on. */
export function userKeySecretsEnabled(credential: string): credential is CredentialId {
  return credential in USER_KEY_PROVIDERS && userSecretsFlag(credential)
}

/** Env var a user key's secret is mounted as inside the sandbox. */
export function userKeyMountEnv(credential: CredentialId): string {
  return `USER_KEY_${credential}`
}

/**
 * Make sure the Daytona secret for a just-saved `credential` value exists
 * (undefined = removed, nothing to do). Creating it here, not only at the
 * next turn, means a turn using it in another sandbox doesn't have to wait
 * on this one's first use. Never throws: the next turn creates it if this
 * fails, and an unused secret simply ages out of the secret-cleanup sweep
 * (see @background-agents/sandbox-secrets' `deleteStaleSecrets`) — there is
 * nothing to prune here any more, since the secret is named after the value
 * itself rather than after the user.
 */
export async function syncUserKeySecret(
  userId: string,
  credential: string,
  value: string | undefined
): Promise<void> {
  if (!value || !userKeySecretsEnabled(credential)) return
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return
  const daytona = new Daytona({ apiKey })
  try {
    await ensureSecret(daytona, () => value, USER_KEY_PROVIDERS[credential as CredentialId]?.hosts)
  } catch (err) {
    console.error(`[user-key-secrets] failed to sync ${credential} secret for user ${userId}:`, err)
  }
}
