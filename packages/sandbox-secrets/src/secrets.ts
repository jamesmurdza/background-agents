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

/**
 * Set exactly `secrets` (env var name → Daytona secret name) as the sandbox's
 * mounted set, plus an internal keepalive secret that is always attached.
 * Pass `{}` to detach everything but the keepalive.
 *
 * Refreshes every named secret's "last used" stamp (see
 * {@link touchSecret}), so a secret {@link setSecrets} is still attaching
 * stays alive. Then restarts the sandbox if it comes back without its
 * secrets proxy wired — checked directly (`printenv HTTPS_PROXY` inside the
 * sandbox) rather than inferred from any stored state, since nothing
 * mount-related is stored any more.
 */
export async function setSecrets(daytona: Daytona, sandbox: Sandbox, secrets: Record<string, string>): Promise<void> {
  const keepaliveName = await ensureKeepaliveSecret(daytona)
  const all = { ...secrets, [KEEPALIVE_ENV]: keepaliveName }

  await Promise.all(Object.values(all).map((name) => touchSecret(daytona, name)))
  await sandbox.updateSecrets(all)

  if (!(await proxyWired(sandbox))) {
    // Files survive the restart; running processes (dev servers, terminals)
    // don't — acceptable once per sandbox.
    console.log(`[sandbox-secrets] restarting sandbox ${sandbox.id} to wire its secrets proxy`)
    await sandbox.stop()
    await sandbox.start()
  }
}

/**
 * Create a Daytona sandbox and immediately set its secrets — the only
 * sanctioned way to create one that needs any. Mounting right after
 * creation still costs the one restart a sandbox created without secrets
 * needs before attached ones work; there's no way around that from this
 * side, since Daytona only wires the secrets proxy at boot.
 */
export async function createSandbox(
  daytona: Daytona,
  opts: CreateSandboxFromSnapshotParams,
  secrets: Record<string, string> = {}
): Promise<Sandbox> {
  const sandbox = await daytona.create(opts)
  await setSecrets(daytona, sandbox, secrets)
  return sandbox
}
