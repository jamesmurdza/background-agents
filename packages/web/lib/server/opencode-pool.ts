/**
 * Shared OpenCode key pool (server-only).
 *
 * The pool is configured as raw keys (`OPENCODE_API_KEY`, one or several
 * comma-separated), but a raw key never enters a sandbox, where anything the
 * agent runs could read it — `env`, `/proc/<pid>/environ`, even a stray
 * `ps aux`. Each key is instead backed by a Daytona secret named after it
 * ({@link secretNameForKey}), created on first use: the sandbox only sees a
 * placeholder, and Daytona's egress proxy swaps in the real value on HTTPS
 * requests to opencode.ai. See lib/server/opencode-secrets.
 *
 * With several keys, each shared run picks one uniformly at random, so an
 * operator can run several keys concurrently instead of manually swapping one.
 *
 * Never imported from client code — reads raw key values from process.env.
 */

import { createHash } from "crypto"

/**
 * Prefix marking a credential value as a reference to a Daytona secret rather
 * than a key. It is what {@link pickSharedOpencodeKey} returns, so everything
 * that only checks whether an OpenCode credential exists keeps working, while
 * the value itself is useless: if it ever reached a sandbox unstripped,
 * OpenCode would fail to authenticate rather than leak anything.
 */
const SECRET_MARKER_PREFIX = "daytona-secret:"

/** Prefix of every Daytona secret backing a pool key. */
const SECRET_NAME_PREFIX = "opencode_"

/** Hex characters of the key's SHA-256 kept in its secret name. */
const SECRET_NAME_HASH_LENGTH = 12

/**
 * The configured shared-pool keys, parsed from the comma-separated
 * `OPENCODE_API_KEY`, trimmed with blanks dropped.
 */
export function getSharedOpencodeKeys(): string[] {
  return parseList(process.env.OPENCODE_API_KEY)
}

/**
 * Daytona secret name for a pool key: a prefix plus a short hash of the key.
 *
 * Derived from the key itself because Daytona never returns a secret's value,
 * so an existing secret can't be checked against the key it should hold. A
 * content-derived name makes that moot: the same key always maps to the same
 * secret (never recreated), and a changed key maps to a new one, so a stale
 * secret can never keep serving a key that was rotated out.
 */
export function secretNameForKey(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, SECRET_NAME_HASH_LENGTH)
  return `${SECRET_NAME_PREFIX}${hash}`
}

/** The Daytona secret names backing the configured pool keys. */
export function getSharedOpencodeSecretNames(): string[] {
  return getSharedOpencodeKeys().map(secretNameForKey)
}

/** The configured pool key a secret name was derived from, if any. */
export function sharedOpencodeKeyForSecret(secretName: string): string | undefined {
  return getSharedOpencodeKeys().find((key) => secretNameForKey(key) === secretName)
}

/** Whether the server has at least one shared OpenCode key configured. */
export function hasSharedOpencodeKey(): boolean {
  return getSharedOpencodeKeys().length > 0
}

/**
 * Pick one shared OpenCode key uniformly at random and return it as a secret
 * marker (see {@link toSecretMarker}) — never the raw key — or undefined when
 * none are configured. Called per shared run so usage spreads evenly across
 * the pool — every entry has an equal chance.
 */
export function pickSharedOpencodeKey(): string | undefined {
  const keys = getSharedOpencodeKeys()
  if (keys.length === 0) return undefined
  return toSecretMarker(secretNameForKey(pickRandom(keys)))
}

/** Wrap a Daytona secret name as a credential value. */
export function toSecretMarker(secretName: string): string {
  return `${SECRET_MARKER_PREFIX}${secretName}`
}

/** The secret name inside a credential marker, or undefined for anything else. */
export function parseSecretMarker(value: string | undefined | null): string | undefined {
  if (!value?.startsWith(SECRET_MARKER_PREFIX)) return undefined
  return value.slice(SECRET_MARKER_PREFIX.length) || undefined
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
