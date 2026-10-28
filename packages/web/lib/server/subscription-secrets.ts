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
 * Each token value gets its own secret, named after a hash of it, so a
 * refreshed token gets a new placeholder. Claude relies on that: when a call
 * fails it asks for a token and only retries with a different one, which the
 * claude-token route mounts mid-turn. Old secrets are pruned when the token
 * refreshes, keeping the newest {@link KEEP_NEWEST} so a turn that started on
 * the previous token keeps working until it ends.
 *
 * On unless DAYTONA_USER_KEY_SECRETS leaves them out (CODEX_CREDENTIALS,
 * CLAUDE_SHARED, CLAUDE_CODE_CREDENTIALS; see userSecretsFlag).
 */

import { Daytona } from "@daytonaio/sdk"
import { contentSecretName, deleteSecrets, type EnsureSecretSpec } from "@background-agents/sandbox-secrets"

import { userKeySecretPrefix, userSecretsFlag } from "@/lib/server/user-key-secrets"

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

export const CLAUDE_SHARED_SECRET_PREFIX = "claude_shared_"
/** Env var the shared Claude token's secret is mounted as; nothing reads it. */
export const CLAUDE_SHARED_MOUNT_ENV = "SESSION_RELAY_TOKEN_CLAUDE"

/** Secrets kept per token when pruning: the current one and the one before. */
export const KEEP_NEWEST = 2

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

export function codexSecretPrefix(userId: string): string {
  return userKeySecretPrefix(userId, "CODEX_CREDENTIALS")
}

/** How to create the secret holding `userId`'s Codex access token `token`. */
export function codexSecretSpec(userId: string, token: string): EnsureSecretSpec {
  return {
    name: contentSecretName(codexSecretPrefix(userId), token),
    value: () => token,
    hosts: CODEX_SECRET_HOSTS,
    description: "Codex ChatGPT access token of a background-agents user",
  }
}

/** How to create the secret holding the shared Claude access token `token`. */
export function claudeSharedSecretSpec(token: string): EnsureSecretSpec {
  return {
    name: contentSecretName(CLAUDE_SHARED_SECRET_PREFIX, token),
    value: () => token,
    hosts: CLAUDE_SECRET_HOSTS,
    description: "Shared Claude subscription access token",
  }
}

export function claudeOwnSecretPrefix(userId: string): string {
  return userKeySecretPrefix(userId, "CLAUDE_CODE_CREDENTIALS")
}

/**
 * How to create the secret holding a Claude run's token, or undefined when
 * that kind isn't put behind one.
 */
export function claudeRunSecretSpec(userId: string, run: ClaudeRunToken): EnsureSecretSpec | undefined {
  if (run.source === "shared") return subscriptionSecretsEnabled("CLAUDE_SHARED") ? claudeSharedSecretSpec(run.token) : undefined
  if (!subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")) return undefined
  return {
    name: contentSecretName(claudeOwnSecretPrefix(userId), run.token),
    value: () => run.token,
    hosts: CLAUDE_SECRET_HOSTS,
    description: "Claude subscription access token of a background-agents user",
  }
}

async function prune(prefix: string, keepNewest: number, what: string): Promise<void> {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return
  try {
    await deleteSecrets(new Daytona({ apiKey }), { prefix, keepNewest })
  } catch (err) {
    console.error(`[subscription-secrets] failed to prune ${what} secrets:`, err)
  }
}

/**
 * After `userId`'s Codex token was refreshed (or with `all`, disconnected):
 * delete their Codex token secrets but the newest. Never throws.
 */
export async function pruneCodexSecrets(userId: string, { all = false }: { all?: boolean } = {}): Promise<void> {
  if (!all && !subscriptionSecretsEnabled("CODEX_CREDENTIALS")) return
  await prune(codexSecretPrefix(userId), all ? 0 : KEEP_NEWEST, "Codex")
}

/**
 * After `userId`'s own Claude token was refreshed (or with `all`, their login
 * replaced or removed): delete its secrets but the newest. Never throws.
 */
export async function pruneClaudeOwnSecrets(userId: string, { all = false }: { all?: boolean } = {}): Promise<void> {
  if (!all && !subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")) return
  await prune(claudeOwnSecretPrefix(userId), all ? 0 : KEEP_NEWEST, "own Claude")
}

/** After the shared Claude token was refreshed: delete its secrets but the newest. Never throws. */
export async function pruneClaudeSharedSecrets(): Promise<void> {
  if (!subscriptionSecretsEnabled("CLAUDE_SHARED")) return
  await prune(CLAUDE_SHARED_SECRET_PREFIX, KEEP_NEWEST, "shared Claude")
}
