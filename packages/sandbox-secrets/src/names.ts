import { createHash } from "node:crypto"

/** Daytona's rule for secret names. */
export const SECRET_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

/**
 * Prefix of every secret this app creates. A single fixed prefix (rather
 * than one per caller/scope) is what lets {@link deleteStaleSecrets} find
 * every secret this app owns with one `name` filter, instead of a sweep
 * that has to know every scope's prefix in advance.
 */
export const SECRET_PREFIX = "bg_"

/**
 * The Daytona secret name for `value` restricted to `hosts`: {@link SECRET_PREFIX}
 * plus a SHA-256 of both.
 *
 * Daytona never returns a secret's value, so an existing secret can't be
 * checked against the value it should hold. Deriving the name from the value
 * (and the hosts it's restricted to) makes that moot: the same value and
 * hosts always map to the same secret (never recreated), and a changed value
 * maps to a new one, so a stale secret can never keep serving a value that
 * was rotated out.
 */
export function secretName(value: string, hosts: string[] = []): string {
  const hash = createHash("sha256").update(JSON.stringify([value, hosts])).digest("hex").slice(0, 16)
  return `${SECRET_PREFIX}${hash}`
}
