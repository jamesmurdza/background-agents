import type { Sandbox } from "@daytonaio/sdk"

/** Secrets mounted on a sandbox: env var name → Daytona secret name. */
export type SecretMounts = Record<string, string>

export interface MountOptions {
  /**
   * Sandbox label recording the mounted set. Its presence also means the
   * sandbox has secrets enabled, so a later (re)mount needs no restart.
   */
  label: string
  /**
   * Sandbox label recording which of the mounted set is pinned: kept
   * attached between turns instead of detached by {@link releaseSecrets}.
   * Without it nothing is pinned.
   */
  pinnedLabel?: string
  /**
   * How long after a (re)mount to wait before relying on it, as the proxy
   * picks a change up "within seconds". Defaults to {@link DEFAULT_PROPAGATION_MS}.
   */
  propagationMs?: number
}

export interface MountResult {
  /** The set now mounted. */
  mounts: SecretMounts
  /** Epoch ms after which the proxy can be relied on to swap it (0 = now). */
  readyAt: number
}

/** Label value for a secrets-enabled sandbox with nothing mounted. */
const DETACHED = "none"

/**
 * Measured at well under a second to re-attach, ~20s for an in-place value
 * update; 3s covers a mount with margin, and most of it usually overlaps
 * other setup work.
 */
export const DEFAULT_PROPAGATION_MS = 3000

/**
 * Encode a set as a label value: `ENV:secret` pairs joined by `:` (neither
 * env var nor secret names can contain one), or {@link DETACHED} when empty.
 * A single mount reads `ENV:secret`, the format used before sets existed.
 */
export function encodeMounts(mounts: SecretMounts): string {
  const entries = Object.entries(mounts)
  if (entries.length === 0) return DETACHED
  return entries.map(([env, name]) => `${env}:${name}`).join(":")
}

/**
 * Decode a label written by {@link encodeMounts}. Undefined for a missing or
 * unrecognised label (e.g. a legacy bare secret name), which callers treat as
 * "mounted set unknown".
 */
export function decodeMounts(label: string | undefined): SecretMounts | undefined {
  if (!label) return undefined
  if (label === DETACHED) return {}
  const parts = label.split(":")
  if (parts.length % 2 !== 0 || parts.some((part) => !part)) return undefined
  const mounts: SecretMounts = {}
  for (let i = 0; i < parts.length; i += 2) mounts[parts[i]] = parts[i + 1]
  return mounts
}

/** Whether `sandbox` has secrets enabled, and what its label says is mounted. */
export function readMounts(sandbox: Sandbox, options: MountOptions): { enabled: boolean; mounts?: SecretMounts } {
  const label = sandbox.labels?.[options.label]
  return { enabled: !!label, mounts: decodeMounts(label) }
}

function sameMounts(a: SecretMounts, b: SecretMounts): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/** The pinned set `sandbox`'s label records (empty when none or unknown). */
export function readPinned(sandbox: Sandbox, options: MountOptions): SecretMounts {
  if (!options.pinnedLabel) return {}
  return decodeMounts(sandbox.labels?.[options.pinnedLabel]) ?? {}
}

/** The pinned label recording `pinned`, when the options have one. */
function pinnedLabels(options: MountOptions, pinned: SecretMounts): Record<string, string> {
  return options.pinnedLabel ? { [options.pinnedLabel]: encodeMounts(pinned) } : {}
}

/** Whether the pinned label already records `pinned` (a missing one records nothing). */
function pinnedRecorded(sandbox: Sandbox, options: MountOptions, pinned: SecretMounts): boolean {
  return !options.pinnedLabel || sameMounts(readPinned(sandbox, options), pinned)
}

/**
 * `daytona.create` params that mount `mounts` and `pinned` from the start, so
 * the new sandbox never needs the restart a later first mount would force.
 */
export function secretsCreateParams(
  mounts: SecretMounts,
  options: MountOptions,
  pinned: SecretMounts = {}
): {
  secrets: SecretMounts
  labels: Record<string, string>
} {
  const all = { ...pinned, ...mounts }
  return { secrets: all, labels: { [options.label]: encodeMounts(all), ...pinnedLabels(options, pinned) } }
}

/**
 * Mount exactly `desired` plus `pinned` on `sandbox`, recording `pinned` as
 * the part {@link releaseSecrets} keeps. A no-op when the labels already
 * record that. Call as early as possible, then {@link waitForPropagation}
 * just before relying on it.
 *
 * Daytona behaviours this handles:
 * - A sandbox created WITHOUT any secrets must be restarted before attached
 *   ones work (the proxy is only wired up at boot). One with the label has
 *   them enabled, and re-attaching after a full detach needs no restart.
 * - The proxy is wired up at every boot, though, and only when some secret
 *   is attached: a labelled sandbox stopped with none attached comes back
 *   without it (its proxy env vars empty). A changed mount checks for that
 *   and restarts such a sandbox too. Keeping one secret attached for good
 *   (see `releaseSecrets`' `keep`) avoids it in the first place.
 * - A mounted env var is visible only to processes spawned after the change.
 *
 * Throws only after restoring the previous set, so a half-finished mount
 * never leaves secrets attached that the label doesn't record — and
 * {@link releaseSecrets} keys off the label.
 */
export async function mountSecrets(
  sandbox: Sandbox,
  desired: SecretMounts,
  options: MountOptions,
  pinned: SecretMounts = {}
): Promise<MountResult> {
  const all = { ...pinned, ...desired }
  const current = sandbox.labels?.[options.label]
  const previous = decodeMounts(current)
  const changed = !previous || !sameMounts(previous, all)
  const pinnedLabel = pinnedLabels(options, pinned)
  if (!changed && pinnedRecorded(sandbox, options, pinned)) return { mounts: all, readyAt: 0 }

  if (changed) await sandbox.updateSecrets(all)
  try {
    let readyAt = changed ? Date.now() + (options.propagationMs ?? DEFAULT_PROPAGATION_MS) : 0
    const proxyLost = !!current && changed && !(await proxyWired(sandbox))
    if (!current || proxyLost) {
      // Files survive the restart; running processes (dev servers, terminals)
      // don't — acceptable once per sandbox.
      console.log(
        `[sandbox-secrets] restarting sandbox ${sandbox.id} to ${proxyLost ? "rewire its secrets proxy" : "enable secrets"}`
      )
      await sandbox.stop()
      await sandbox.start()
      readyAt = 0
    }
    await sandbox.setLabels({ ...sandbox.labels, [options.label]: encodeMounts(all), ...pinnedLabel })
    return { mounts: all, readyAt }
  } catch (err) {
    if (!changed) throw err
    // The set is attached but the label recording it is not written, so
    // leaving it would strand mounts nothing ever detaches. Put back what the
    // label still describes before the caller sees the failure.
    await sandbox.updateSecrets(previous ?? {}).catch((rollbackErr) => {
      console.error(`[sandbox-secrets] failed to roll back the mount on sandbox ${sandbox.id}:`, rollbackErr)
    })
    throw err
  }
}

/**
 * Whether `sandbox` booted with the secrets proxy: every process there has
 * HTTPS_PROXY pointing at it, mounted secrets or not, and an empty one when
 * it booted without. Assumed so when it can't be checked.
 */
async function proxyWired(sandbox: Sandbox): Promise<boolean> {
  try {
    const { result } = await sandbox.process.executeCommand("printenv HTTPS_PROXY", undefined, undefined, 15)
    return result.trim() !== ""
  } catch (err) {
    console.error(`[sandbox-secrets] couldn't check the secrets proxy of sandbox ${sandbox.id}:`, err)
    return true
  }
}

/** Sleep until a freshly mounted set has reached the proxy. */
export async function waitForPropagation(mounted: { readyAt: number }): Promise<void> {
  const remaining = mounted.readyAt - Date.now()
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
}

/**
 * Shrink the mounted set to `keep`, which is then the pinned set. By default
 * `keep` is the pinned set the label records (with no pinned label: nothing),
 * so a turn's secrets detach and pinned ones stay. A no-op (no API call) when
 * the sandbox has never had secrets or already has exactly `keep`. Never throws — a failed detach leaves secrets live a while longer,
 * which must not fail whatever it follows.
 *
 * The label is written BEFORE the detach, and restored if the detach fails.
 * Callers may trust a label to skip a mount, so the opposite order could
 * leave a label claiming mounts that no longer exist. This way the only
 * possible mismatch is a label listing fewer mounts than are live, which the
 * next {@link mountSecrets} simply re-attaches.
 */
export async function releaseSecrets(
  sandbox: Sandbox,
  options: MountOptions,
  keep: SecretMounts = readPinned(sandbox, options)
): Promise<void> {
  const current = sandbox.labels?.[options.label]
  if (!current) return
  const previous = decodeMounts(current)
  const changed = !previous || !sameMounts(previous, keep)
  const pinnedLabel = pinnedLabels(options, keep)
  if (!changed && pinnedRecorded(sandbox, options, keep)) return

  const labels = { ...sandbox.labels }
  try {
    await sandbox.setLabels({ ...labels, [options.label]: encodeMounts(keep), ...pinnedLabel })
  } catch (err) {
    console.error(`[sandbox-secrets] failed to detach secrets from sandbox ${sandbox.id}:`, err)
    return
  }
  if (!changed) return
  try {
    await sandbox.updateSecrets(keep)
  } catch (err) {
    console.error(`[sandbox-secrets] failed to detach secrets from sandbox ${sandbox.id}:`, err)
    // Still mounted: say so again, so the next mount keeps them without waiting.
    await sandbox.setLabels(labels).catch(() => {})
  }
}
