/**
 * Users' chat and repo env vars via Daytona secrets (server-only).
 *
 * A user can mark an env var as a secret and name the hosts it may be sent
 * to. The agent (and everything in the sandbox) then sees only the secret's
 * placeholder, which Daytona's proxy swaps for the value on HTTPS requests to
 * those hosts — headers and Basic auth only, not query strings.
 *
 * Unlike provider keys (lib/server/user-key-secrets), these stay mounted
 * between turns: a dev server the agent started keeps using the placeholder
 * after the turn ends, and the value is the user's own, chosen for exactly
 * that. lib/server/turn-secrets mounts them as pinned.
 *
 * Stored inline with the plain ones (`Chat.environmentVariables`,
 * `User.repoEnvironmentVariables[repo]`): a plain var is its encrypted value,
 * a secret one `{ v: <encrypted value>, hosts }`. Each secret is named after
 * the user, the scope (chat or repo) and a hash of the var, so a changed
 * value or host list gets a new secret ({@link envVarSecretSpec}), and saving
 * deletes the scope's others ({@link syncEnvVarSecrets}). A run's vars are
 * loaded by loadUserEnvVars (lib/server/user-env-vars).
 *
 * On unless DAYTONA_USER_KEY_SECRETS leaves out ENV_VARS (see
 * userSecretsFlag); the hosts are stored either way, so turning it on later
 * needs no re-entry.
 */

import { createHash } from "node:crypto"
import { Daytona } from "@daytonaio/sdk"
import {
  ENV_NAME_PATTERN,
  contentSecretName,
  deleteSecrets,
  ensureSecret,
  type EnsureSecretSpec,
} from "@background-agents/sandbox-secrets"

import { decrypt, encrypt } from "@/lib/db/encryption"
import type { SecretEnvHosts } from "@/lib/types"
import { userKeySecretPrefix, userSecretsFlag } from "@/lib/server/user-key-secrets"

/** A stored env var: its encrypted value, or for a secret, that and its hosts. */
export type StoredEnvVar = string | { v: string; hosts: string[] }

/** Decrypted env vars of one scope. */
export interface EnvVarSet {
  values: Record<string, string>
  secretHosts: SecretEnvHosts
}

/** An env var to put behind a secret for a run. */
export interface EnvVarSecret {
  key: string
  value: string
  hosts: string[]
  /** Where it was set: {@link chatEnvScope} or {@link repoEnvScope}. */
  scope: string
}

/** The env vars a chat's runs get: chat over repo. */
export interface UserEnvVars {
  values: Record<string, string>
  /** Those among {@link values} marked as secrets. */
  secrets: EnvVarSecret[]
}

/**
 * At most this many secret vars per chat or repo. A sandbox mounts both
 * scopes plus a turn's keys, and Daytona caps secrets per sandbox (20 in its
 * sample org settings; ours is unconfirmed).
 */
export const MAX_SECRET_ENV_VARS = 8
const MAX_HOSTS = 10
const HOST_PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+$/
/** Names our own mounts and the proxy use. */
const RESERVED_NAME = /^(SESSION_RELAY_TOKEN|USER_KEY_|ENDPOINT_SECRET_)|^(https?|no|all)_proxy$/i

export function envVarSecretsEnabled(): boolean {
  return userSecretsFlag("ENV_VARS")
}

export const chatEnvScope = (chatId: string) => `chat:${chatId}`
export const repoEnvScope = (repo: string) => `repo:${repo}`

/** Decrypt a stored scope. */
export function decodeEnvVars(stored: unknown): EnvVarSet {
  const set: EnvVarSet = { values: {}, secretHosts: {} }
  if (!stored || typeof stored !== "object") return set
  for (const [key, entry] of Object.entries(stored as Record<string, StoredEnvVar>)) {
    if (typeof entry === "string") {
      if (entry) set.values[key] = decrypt(entry)
    } else if (entry && typeof entry.v === "string") {
      set.values[key] = decrypt(entry.v)
      if (Array.isArray(entry.hosts) && entry.hosts.length > 0) set.secretHosts[key] = entry.hosts
    }
  }
  return set
}

/** Whether a stored scope has any secret var, without decrypting it. */
export function hasSecretEnvVars(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false
  return Object.values(stored).some((entry) => entry !== null && typeof entry === "object")
}

/** Encrypt a scope for storage. */
export function encodeEnvVars({ values, secretHosts }: EnvVarSet): Record<string, StoredEnvVar> {
  const stored: Record<string, StoredEnvVar> = {}
  for (const [key, value] of Object.entries(values)) {
    const hosts = secretHosts[key]
    stored[key] = hosts ? { v: encrypt(value), hosts } : encrypt(value)
  }
  return stored
}

/**
 * Validate a request's env vars and their secret hosts, trimming names and
 * normalising hosts. Returns the set, or a message for a 400.
 */
export function parseEnvVarSet(values: unknown, secretHosts: unknown): EnvVarSet | string {
  if (!values || typeof values !== "object") return "Invalid environmentVariables"
  const set: EnvVarSet = { values: {}, secretHosts: {} }
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && key.trim()) set.values[key.trim()] = value
  }
  if (secretHosts === undefined || secretHosts === null) return set
  if (typeof secretHosts !== "object") return "Invalid secretEnvironmentVariables"
  for (const [rawKey, rawHosts] of Object.entries(secretHosts)) {
    const key = rawKey.trim()
    if (!(key in set.values)) continue
    if (!ENV_NAME_PATTERN.test(key)) return `${key} can't be a secret: use letters, digits and underscores only`
    if (RESERVED_NAME.test(key)) return `${key} can't be a secret: the name is reserved`
    if (!Array.isArray(rawHosts)) return `Invalid hosts for ${key}`
    const hosts = [...new Set(rawHosts.map((h) => (typeof h === "string" ? h.trim().toLowerCase() : "")).filter(Boolean))]
    if (hosts.length === 0) return `Add at least one host ${key} may be sent to`
    if (hosts.length > MAX_HOSTS) return `${key} can have at most ${MAX_HOSTS} hosts`
    const bad = hosts.find((h) => !HOST_PATTERN.test(h))
    if (bad) return `"${bad}" isn't a host name (e.g. api.example.com or *.example.com)`
    set.secretHosts[key] = hosts
  }
  if (Object.keys(set.secretHosts).length > MAX_SECRET_ENV_VARS) {
    return `At most ${MAX_SECRET_ENV_VARS} secret variables per chat or repository`
  }
  return set
}

/** Prefix of every secret holding one of `userId`'s env vars in `scope`. */
export function envVarSecretPrefix(userId: string, scope: string): string {
  const scopeTag = createHash("sha256").update(scope).digest("hex").slice(0, 8)
  return `${userKeySecretPrefix(userId)}env_${scopeTag}_`
}

/** How to create the secret holding a var. */
export function envVarSecretSpec(userId: string, secret: EnvVarSecret): EnsureSecretSpec {
  return {
    name: contentSecretName(
      envVarSecretPrefix(userId, secret.scope),
      `${secret.key}\n${secret.hosts.join(",")}\n${secret.value}`
    ),
    value: () => secret.value,
    hosts: secret.hosts,
    description: `${secret.key} env var of a background-agents user`,
  }
}

/** The secret vars of a scope (an empty value has nothing to protect). */
export function envVarSecretsOf(set: EnvVarSet, scope: string): EnvVarSecret[] {
  return Object.entries(set.secretHosts).flatMap(([key, hosts]) =>
    set.values[key] ? [{ key, value: set.values[key], hosts, scope }] : []
  )
}

/**
 * Bring a scope's secrets in line with a just-saved set: create the secret
 * vars' secrets and delete the scope's others. A sandbox still mounting a
 * deleted one loses it within about half a minute; its next turn mounts the
 * new one. Never throws: the next turn creates what's missing, and a stale
 * secret only costs storage.
 */
export async function syncEnvVarSecrets(userId: string, scope: string, set: EnvVarSet): Promise<void> {
  if (!envVarSecretsEnabled()) return
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return
  const daytona = new Daytona({ apiKey })
  try {
    const keep: string[] = []
    for (const secret of envVarSecretsOf(set, scope)) {
      keep.push((await ensureSecret(daytona, envVarSecretSpec(userId, secret))).name)
    }
    await deleteSecrets(daytona, { prefix: envVarSecretPrefix(userId, scope), keep })
  } catch (err) {
    console.error(`[env-var-secrets] failed to sync ${scope.split(":")[0]} env var secrets:`, err)
  }
}
