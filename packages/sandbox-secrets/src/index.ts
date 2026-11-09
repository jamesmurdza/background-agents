/**
 * Keep credentials out of Daytona sandboxes.
 *
 * A Daytona secret mounted on a sandbox shows up there only as an opaque
 * placeholder; Daytona's egress proxy swaps in the real value on HTTPS
 * requests to the secret's allowed hosts (headers and Basic auth — not query
 * strings). Anything inside the sandbox can still USE the placeholder while
 * the secret is mounted, but no process there can read the value itself.
 */
export { secretName, SECRET_NAME_PATTERN, SECRET_PREFIX } from "./names"
export { parseSecretMarker, toSecretMarker } from "./marker"
export { deleteStaleSecrets, ensureSecret, secretLastUsedAt, stampLastUsed } from "./store"
export { createSandbox, setSecrets } from "./secrets"
