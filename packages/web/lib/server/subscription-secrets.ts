/**
 * Subscription access tokens via Daytona secrets (server-only): the Codex
 * ChatGPT subscription, the shared Claude subscription and a user's own.
 *
 * All are OAuth access tokens the server refreshes; the refresh token never
 * reaches a sandbox either way (lib/server/codex-credentials,
 * lib/server/refresh-claude-credentials, lib/server/user-claude-credentials). Behind a secret, the access token
 * doesn't either: the agent gets its placeholder, mounted for the turn like
 * any key (lib/server/turn-secrets).
 *
 * Each token value gets its own secret, named after a hash of it (see
 * {@link secretName}), so a refreshed token gets a new placeholder. Claude
 * relies on that: when a call fails it asks for a token and only retries
 * with a different one, which the claude-token route mounts mid-turn. A
 * secret for a token that stopped being used simply ages out of the
 * app-wide secret-cleanup sweep (see @background-agents/sandbox-secrets'
 * `deleteStaleSecrets`) rather than being eagerly pruned per user or scope.
 *
 * On unless DAYTONA_USER_KEY_SECRETS leaves them out (CODEX_CREDENTIALS,
 * CLAUDE_SHARED, CLAUDE_CODE_CREDENTIALS; see userSecretsFlag).
 */

import type { Daytona } from "@daytonaio/sdk"
import { ensureSecret } from "@background-agents/sandbox-secrets"

import { userSecretsFlag } from "@/lib/server/user-key-secrets"

export type SubscriptionSecret = "CODEX_CREDENTIALS" | "CLAUDE_SHARED" | "CLAUDE_CODE_CREDENTIALS"

/**
 * The access token a Claude Code run fetches from the claude-token route:
 * the shared pool's, or the user's own subscription's.
 */
export interface ClaudeRunToken {
  source: "shared" | "own"
  token: string
}

/** Hosts the Codex CLI sends a ChatGPT access token to. */
export const CODEX_SECRET_HOSTS = ["chatgpt.com", "*.chatgpt.com"]
/** Where Claude Code sends a subscription access token. */
export const CLAUDE_SECRET_HOSTS = ["api.anthropic.com"]

/** Env var the shared Claude token's secret is mounted as; nothing reads it. */
export const CLAUDE_SHARED_MOUNT_ENV = "SESSION_RELAY_TOKEN_CLAUDE"

/** Whether `kind` is put behind a secret. */
export function subscriptionSecretsEnabled(kind: SubscriptionSecret): boolean {
  return userSecretsFlag(kind)
}

/** The access token in a rendered Codex auth.json (see lib/codex-credentials). */
export function codexAccessToken(authJson: string): string | undefined {
  try {
    const token = (JSON.parse(authJson) as { tokens?: { access_token?: unknown } } | null)?.tokens?.access_token
    return typeof token === "string" && token ? token : undefined
  } catch {
    // Parser errors can quote the token.
    return undefined
  }
}

/** Make sure the Daytona secret for a Codex access token `token` exists, and return its placeholder. */
export function ensureCodexSecret(daytona: Daytona, token: string): Promise<string> {
  return ensureSecret(daytona, () => token, CODEX_SECRET_HOSTS)
}

/** Make sure the Daytona secret for the shared Claude access token `token` exists, and return its placeholder. */
export function ensureClaudeSharedSecret(daytona: Daytona, token: string): Promise<string> {
  return ensureSecret(daytona, () => token, CLAUDE_SECRET_HOSTS)
}

/**
 * Make sure the Daytona secret for a Claude run's token exists, and return
 * its placeholder — or undefined when that kind isn't put behind one.
 */
export function ensureClaudeRunSecret(
  daytona: Daytona,
  run: ClaudeRunToken
): Promise<string> | undefined {
  if (run.source === "shared") return subscriptionSecretsEnabled("CLAUDE_SHARED") ? ensureClaudeSharedSecret(daytona, run.token) : undefined
  if (!subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")) return undefined
  return ensureSecret(daytona, () => run.token, CLAUDE_SECRET_HOSTS)
}

/**
 * Previously pruned a user's or the shared pool's old subscription-token
 * secrets eagerly on refresh (per-user/per-scope name prefixes made that
 * possible). Secrets are no longer named per user or scope — just per value
 * — so there is nothing to find and delete here any more: an old token's
 * secret simply stops being touched, and ages out of the app-wide
 * secret-cleanup sweep (see @background-agents/sandbox-secrets'
 * `deleteStaleSecrets`) like anything else unused. Kept as a no-op so
 * existing call sites don't need to change.
 */
export async function pruneCodexSecrets(_userId: string, _options?: { all?: boolean }): Promise<void> {}

/** @see pruneCodexSecrets */
export async function pruneClaudeOwnSecrets(_userId: string, _options?: { all?: boolean }): Promise<void> {}

/** @see pruneCodexSecrets */
export async function pruneClaudeSharedSecrets(): Promise<void> {}
