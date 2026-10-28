import { createHash } from "node:crypto"

/** Daytona's rule for secret names. */
export const SECRET_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/

/** Names a secret can be mounted under inside a sandbox (POSIX env var names). */
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A secret name derived from the secret's own value: `prefix` plus a short
 * SHA-256 of it.
 *
 * Daytona never returns a secret's value, so an existing secret can't be
 * checked against the value it should hold. Deriving the name from the value
 * makes that moot: the same value always maps to the same secret (never
 * recreated), and a changed value maps to a new one, so a stale secret can
 * never keep serving a value that was rotated out.
 */
export function contentSecretName(prefix: string, value: string, hashLength = 12): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, hashLength)
  return `${prefix}${hash}`
}
