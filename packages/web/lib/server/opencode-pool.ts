/**
 * Shared OpenCode key pool (server-only).
 *
 * The pool can be backed two ways:
 *
 * - **Daytona secrets** (`OPENCODE_DAYTONA_SECRETS`, comma-separated secret
 *   names). The raw key never enters the sandbox: Daytona sets
 *   `OPENCODE_API_KEY` to a placeholder and its egress proxy swaps in the real
 *   value on HTTPS requests to the secret's allowed hosts. Takes precedence
 *   whenever it is set. See lib/server/opencode-secrets.
 * - **Raw keys** (`OPENCODE_API_KEY`, one or several comma-separated). The key
 *   is exported into the sandbox, where anything the agent runs can read it —
 *   `env`, `/proc/<pid>/environ`, even a stray `ps aux`. Kept only as the
 *   fallback for deployments without secrets configured.
 *
 * With several entries, each shared run picks one uniformly at random, so an
 * operator can run several keys concurrently instead of manually swapping one.
 *
 * Never imported from client code — reads raw key values from process.env.
 */

/**
 * Prefix marking a credential value as a reference to a Daytona secret rather
 * than a key. It is what {@link pickSharedOpencodeKey} returns in secrets mode,
 * so everything that only checks whether an OpenCode credential exists keeps
 * working, while the value itself is useless: if it ever reached a sandbox
 * unstripped, OpenCode would fail to authenticate rather than leak anything.
 */
const SECRET_MARKER_PREFIX = "daytona-secret:"

/**
 * The configured shared-pool keys, parsed from the comma-separated
 * `OPENCODE_API_KEY`, trimmed with blanks dropped.
 */
export function getSharedOpencodeKeys(): string[] {
  return parseList(process.env.OPENCODE_API_KEY)
}

/**
 * The Daytona secret names backing the shared pool, parsed from the
 * comma-separated `OPENCODE_DAYTONA_SECRETS`. Empty when secrets mode is off.
 */
export function getSharedOpencodeSecretNames(): string[] {
  return parseList(process.env.OPENCODE_DAYTONA_SECRETS)
}

/** Whether the server has at least one shared OpenCode key or secret configured. */
export function hasSharedOpencodeKey(): boolean {
  return getSharedOpencodeSecretNames().length > 0 || getSharedOpencodeKeys().length > 0
}

/**
 * Pick one shared OpenCode credential uniformly at random, or undefined when
 * none are configured. In secrets mode this is a secret marker (see
 * {@link toSecretMarker}), never a raw key. Called per shared run so usage
 * spreads evenly across the pool — every entry has an equal chance.
 */
export function pickSharedOpencodeKey(): string | undefined {
  const secrets = getSharedOpencodeSecretNames()
  if (secrets.length > 0) return toSecretMarker(pickRandom(secrets))
  const keys = getSharedOpencodeKeys()
  if (keys.length === 0) return undefined
  return pickRandom(keys)
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
