/**
 * Keep credentials out of Daytona sandboxes.
 *
 * A Daytona secret mounted on a sandbox shows up there only as an opaque
 * placeholder; Daytona's egress proxy swaps in the real value on HTTPS
 * requests to the secret's allowed hosts (headers and Basic auth — not query
 * strings). Anything inside the sandbox can still USE the placeholder while
 * the secret is mounted, but no process there can read the value itself.
 */
export { contentSecretName, ENV_NAME_PATTERN, SECRET_NAME_PATTERN } from "./names"
export { parseSecretMarker, toSecretMarker } from "./marker"
export {
  REVERIFY_MS,
  deleteSecrets,
  ensureSecret,
  forgetSecrets,
  secretLastUsedAt,
  stampLastUsed,
  type EnsureSecretSpec,
  type EnsuredSecret,
} from "./store"
export {
  DEFAULT_PROPAGATION_MS,
  decodeMounts,
  encodeMounts,
  mountSecrets,
  readMounts,
  readPinned,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
  type MountOptions,
  type MountResult,
  type SecretMounts,
} from "./mount"
