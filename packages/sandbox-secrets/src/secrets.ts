import type { CreateSandboxFromSnapshotParams, Daytona, Sandbox } from "@daytonaio/sdk"

import { secretName } from "./names"
import { ensureSecret, touchSecret } from "./store"

/**
 * A secret attached to every sandbox {@link setSecrets} touches, and never
 * detached. Daytona wires a sandbox's secrets proxy at boot only when some
 * secret is attached, so one stopped with none attached comes back without
 * it (its proxy env vars empty) and sends placeholders out unswapped —
 * {@link setSecrets} then has to restart it. Holds no credential, and its
 * host never resolves.
 */
const KEEPALIVE_VALUE = "keepalive"
const KEEPALIVE_HOSTS = ["keepalive.invalid"]
const KEEPALIVE_ENV = "SESSION_RELAY_TOKEN_KEEPALIVE"

async function ensureKeepaliveSecret(daytona: Daytona): Promise<string> {
  await ensureSecret(daytona, () => KEEPALIVE_VALUE, KEEPALIVE_HOSTS)
  return secretName(KEEPALIVE_VALUE, KEEPALIVE_HOSTS)
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

/** `secrets` plus the keepalive, each stamped as used (see {@link touchSecret}). */
async function withKeepalive(daytona: Daytona, secrets: Record<string, string>): Promise<Record<string, string>> {
  const all = { ...secrets, [KEEPALIVE_ENV]: await ensureKeepaliveSecret(daytona) }
  await Promise.all(Object.values(all).map((name) => touchSecret(daytona, name)))
  return all
}

/**
 * Set exactly `secrets` (env var name → Daytona secret name) as the sandbox's
 * mounted set, plus an internal keepalive secret that is always attached.
 * Pass `{}` to detach everything but the keepalive.
 *
 * Refreshes every named secret's "last used" stamp, so a secret
 * {@link setSecrets} is still attaching stays alive. When `secrets` isn't
 * empty, restarts the sandbox if it booted without its secrets proxy —
 * checked directly (`printenv HTTPS_PROXY` inside the sandbox). With nothing
 * to attach it never restarts: a sandbox that doesn't need secrets keeps its
 * running processes.
 */
export async function setSecrets(daytona: Daytona, sandbox: Sandbox, secrets: Record<string, string>): Promise<void> {
  await sandbox.updateSecrets(await withKeepalive(daytona, secrets))

  if (Object.keys(secrets).length > 0 && !(await proxyWired(sandbox))) {
    // Files survive the restart; running processes (dev servers, terminals)
    // don't — acceptable once per sandbox.
    console.log(`[sandbox-secrets] restarting sandbox ${sandbox.id} to wire its secrets proxy`)
    await sandbox.stop()
    await sandbox.start()
  }
}

/**
 * Create a Daytona sandbox with `secrets` (plus the keepalive) attached from
 * the start, so it boots with its secrets proxy wired and never needs the
 * restart a later first mount would force.
 */
export async function createSandbox(
  daytona: Daytona,
  opts: CreateSandboxFromSnapshotParams,
  secrets: Record<string, string> = {}
): Promise<Sandbox> {
  return daytona.create({ ...opts, secrets: await withKeepalive(daytona, secrets) })
}
