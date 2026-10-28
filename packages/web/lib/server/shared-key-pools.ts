/**
 * Shared provider key pools (server-only).
 *
 * Each pool is configured as raw keys in its server env var (one or several
 * comma-separated), but a raw key never enters a sandbox, where anything the
 * agent runs could read it — `env`, `/proc/<pid>/environ`, even a stray
 * `ps aux`. Each key is instead backed by a Daytona secret named after it
 * ({@link secretNameForKey}), created on first use: the sandbox only sees a
 * placeholder, and Daytona's egress proxy swaps in the real value on HTTPS
 * requests to the pool's hosts. See lib/server/shared-pool-secrets.
 *
 * With several keys, each shared run picks one uniformly at random, so an
 * operator can run several keys concurrently instead of manually swapping one.
 *
 * Never imported from client code — reads raw key values from process.env.
 */

import { contentSecretName, parseSecretMarker, toSecretMarker } from "@background-agents/sandbox-secrets"

export type SharedPoolId = "opencode" | "gemini"

export interface SharedKeyPool {
  /** Matches the provider id models name in `requiresKey`. */
  id: SharedPoolId
  /** Server env var holding the pool's keys, and the credential id they back. */
  envKey: "OPENCODE_API_KEY" | "GEMINI_API_KEY"
  /** Prefix of every Daytona secret backing one of the pool's keys. */
  secretPrefix: string
  /** Hosts the pool's keys may be sent to. */
  hosts: string[]
  /**
   * Env var a pool secret is mounted as inside the sandbox. Deliberately not
   * a name any CLI reads on its own: only the agent's process is handed the
   * placeholder (see lib/server/turn-secrets).
   */
  mountEnv: string
  /** Human name, for secret descriptions and errors. */
  label: string
}

export const SHARED_KEY_POOLS: Record<SharedPoolId, SharedKeyPool> = {
  opencode: {
    id: "opencode",
    envKey: "OPENCODE_API_KEY",
    secretPrefix: "opencode_",
    hosts: ["opencode.ai"],
    // Predates the other pools; live sandbox labels record it, so it stays.
    mountEnv: "SESSION_RELAY_TOKEN",
    label: "OpenCode",
  },
  gemini: {
    id: "gemini",
    envKey: "GEMINI_API_KEY",
    secretPrefix: "gemini_",
    hosts: ["generativelanguage.googleapis.com"],
    mountEnv: "SESSION_RELAY_TOKEN_GEMINI",
    label: "Gemini",
  },
}

const POOLS = Object.values(SHARED_KEY_POOLS)

/** Hex characters of the key's SHA-256 kept in its secret name. */
const SECRET_NAME_HASH_LENGTH = 12

/** The pool a provider id (as models name it in `requiresKey`) draws on, if any. */
export function sharedPoolForProvider(provider: string | undefined): SharedKeyPool | undefined {
  return POOLS.find((pool) => pool.id === provider)
}

/** The pool backing a credential id, if any. */
export function sharedPoolForCredential(credentialId: string): SharedKeyPool | undefined {
  return POOLS.find((pool) => pool.envKey === credentialId)
}

/** The pool a secret name belongs to, by its prefix. */
export function sharedPoolForSecret(secretName: string): SharedKeyPool | undefined {
  return POOLS.find((pool) => secretName.startsWith(pool.secretPrefix))
}

/**
 * The pool's configured keys, parsed from its comma-separated env var,
 * trimmed with blanks dropped.
 */
export function getSharedKeys(pool: SharedKeyPool): string[] {
  return parseList(process.env[pool.envKey])
}

/**
 * Daytona secret name for a pool key: the pool's prefix plus a short hash of
 * the key, so a rotated key gets a new secret (see contentSecretName).
 */
export function secretNameForKey(pool: SharedKeyPool, key: string): string {
  return contentSecretName(pool.secretPrefix, key, SECRET_NAME_HASH_LENGTH)
}

/** The Daytona secret names backing the pool's configured keys. */
export function getSharedSecretNames(pool: SharedKeyPool): string[] {
  return getSharedKeys(pool).map((key) => secretNameForKey(pool, key))
}

/** The configured pool key a secret name was derived from, if any. */
export function sharedKeyForSecret(secretName: string): string | undefined {
  const pool = sharedPoolForSecret(secretName)
  if (!pool) return undefined
  return getSharedKeys(pool).find((key) => secretNameForKey(pool, key) === secretName)
}

/** Whether the server has at least one key configured for the pool. */
export function hasSharedKey(pool: SharedKeyPool): boolean {
  return getSharedKeys(pool).length > 0
}

/**
 * Pick one of the pool's keys uniformly at random and return it as a secret
 * marker (see toSecretMarker) — never the raw key — or undefined when none
 * are configured. The marker keeps every "is there a credential?" check
 * working, while being useless if it ever reached a sandbox unstripped.
 * Called per shared run so usage spreads evenly across the pool — every entry
 * has an equal chance.
 */
export function pickSharedKey(pool: SharedKeyPool): string | undefined {
  const keys = getSharedKeys(pool)
  if (keys.length === 0) return undefined
  return toSecretMarker(secretNameForKey(pool, pickRandom(keys)))
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => !!k)
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Number of trailing characters kept as a key's public fingerprint. */
const KEY_FINGERPRINT_LENGTH = 5

/**
 * Public fingerprint for a pool key: its last {@link KEY_FINGERPRINT_LENGTH}
 * characters. Stored on TokenUsage rows so spend can be attributed per key, and
 * rendered in the admin dashboard as e.g. "…Ca2RK".
 *
 * Deliberately lossy — five characters is enough to tell a handful of pool keys
 * apart (~916M combinations over the alphanumeric alphabet OpenCode uses) while
 * being useless for reconstructing the credential. Never log or persist the
 * full key.
 *
 * A secret marker fingerprints as the secret's name — a name is not a
 * credential, so there is nothing to truncate.
 *
 * Returns undefined for a missing or too-short key so callers can simply omit
 * the field rather than storing a meaningless value.
 */
export function fingerprintKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined
  const secretName = parseSecretMarker(key)
  if (secretName) return secretName
  const trimmed = key.trim()
  if (trimmed.length < KEY_FINGERPRINT_LENGTH) return undefined
  return trimmed.slice(-KEY_FINGERPRINT_LENGTH)
}
