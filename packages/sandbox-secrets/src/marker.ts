/**
 * Prefix marking a credential value as a reference to a Daytona secret rather
 * than the credential itself. Code that only checks whether a credential
 * exists keeps working with a marker, while the value is useless on its own:
 * if it ever reached a sandbox unstripped, the agent would fail to
 * authenticate rather than leak anything.
 */
const SECRET_MARKER_PREFIX = "daytona-secret:"

/** Wrap a Daytona secret name as a credential value. */
export function toSecretMarker(secretName: string): string {
  return `${SECRET_MARKER_PREFIX}${secretName}`
}

/** The secret name inside a credential marker, or undefined for anything else. */
export function parseSecretMarker(value: string | undefined | null): string | undefined {
  if (!value?.startsWith(SECRET_MARKER_PREFIX)) return undefined
  return value.slice(SECRET_MARKER_PREFIX.length) || undefined
}
