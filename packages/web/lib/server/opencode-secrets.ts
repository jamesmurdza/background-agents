/**
 * Shared OpenCode key via Daytona secrets (server-only).
 *
 * In secrets mode (see lib/server/opencode-pool) the shared OpenCode key is
 * never handed to a sandbox. Instead a Daytona secret is mounted on it as
 * {@link SECRET_ENV}: the sandbox sees only an opaque placeholder, and
 * Daytona's egress proxy substitutes the real key on HTTPS requests to the
 * secret's allowed hosts (opencode.ai). Printing the env, reading
 * `/proc/<pid>/environ` or running `ps aux` inside the sandbox reveals nothing
 * usable outside it.
 *
 * The placeholder is deliberately NOT mounted as `OPENCODE_API_KEY`, which a
 * plain `opencode` TUI in the sandbox terminal would pick up on its own. Only
 * the agent's process is told where the key is, through an inline
 * `OPENCODE_CONFIG_CONTENT` override (see {@link applySecretToAgentEnv}) that
 * OpenCode merges over the global opencode.json. That stops casual use, not a
 * determined user — the variable is visible in `env` — which is why the mount
 * also only lives for the duration of a turn.
 *
 * The placeholder still works from anywhere INSIDE the sandbox — the terminal,
 * the OpenCode TUI, a plain curl — and that traffic bypasses metering. So the
 * secret is mounted only for the duration of a turn: {@link mountSharedOpencodeSecret}
 * at send time, {@link releaseSharedOpencodeSecret} wherever a turn ends. Between
 * turns the placeholder is dead weight; the proxy no longer swaps it.
 *
 * The {@link OPENCODE_SECRET_LABEL} label tracks the state on the sandbox: the
 * mounted secret's name during a turn, {@link DETACHED} between turns, absent
 * on sandboxes that have never had a secret. Daytona behaviours this works
 * around:
 * - A sandbox created WITHOUT any secrets must be restarted before newly
 *   attached ones work. New sandboxes therefore get the secret at creation
 *   (see {@link opencodeSecretCreateParams}); older ones are restarted once, on
 *   their first shared OpenCode turn. A detached sandbox (label present) is
 *   remounted without one.
 * - A (re)mount reaches the proxy "within seconds", and a mounted env var is
 *   visible only to processes spawned after it. The agent is spawned fresh
 *   each turn; {@link waitForSecretPropagation} covers the proxy delay.
 */

import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { modelRequiresKey, type Agent } from "@background-agents/common"

import type { Credentials } from "@/lib/credentials"
import { getSharedOpencodeSecretNames, parseSecretMarker } from "@/lib/server/opencode-pool"

/** Env var the credential marker arrives in, from getUserCredentials. */
const OPENCODE_KEY_ENV = "OPENCODE_API_KEY"

/** Env var the secret's placeholder is mounted as inside the sandbox. */
const SECRET_ENV = "SESSION_RELAY_TOKEN"

/**
 * Inline OpenCode config pointing the OpenCode Go provider at {@link SECRET_ENV}.
 * Set only in the agent's env, so nothing else in the sandbox is configured
 * to use the key.
 */
const AGENT_OPENCODE_CONFIG = JSON.stringify({
  provider: { "opencode-go": { options: { apiKey: `{env:${SECRET_ENV}}` } } },
})

/**
 * Sandbox label recording the secret state: `<env var>:<secret name>` while
 * mounted, {@link DETACHED} between turns. Its presence also means the sandbox
 * has secrets enabled, so a (re)mount needs no restart. Carrying the env var
 * means a sandbox mounted under an older name is remounted rather than reused.
 */
export const OPENCODE_SECRET_LABEL = "opencode-secret"

/** Label value for a secrets-enabled sandbox with nothing mounted. */
const DETACHED = "none"

/**
 * How long after a remount the agent should wait before its first request, so
 * it doesn't reach the proxy before the new mount does. Daytona documents only
 * "within seconds". Most of it overlaps work the send does anyway.
 */
const SECRET_PROPAGATION_MS = 3000

export interface MountedSecret {
  /** The secret now mounted — the key id to attribute this turn's usage to. */
  name: string
  /** Epoch ms after which the proxy can be relied on to recognise it. */
  readyAt: number
}

/**
 * The secret this run would mount, or undefined when the run doesn't draw on
 * the shared OpenCode pool in secrets mode (own key, free model, other agent,
 * raw-key mode).
 */
export function sharedOpencodeSecretForRun(
  credentials: Credentials,
  agent: Agent,
  model: string | undefined
): string | undefined {
  if (modelRequiresKey(agent, model) !== "opencode") return undefined
  return parseSecretMarker(credentials.OPENCODE_API_KEY)
}

/**
 * `daytona.create` params that mount `secretName` from the start, so the new
 * sandbox never needs the restart a later first mount would force.
 */
export function opencodeSecretCreateParams(secretName: string): {
  secrets: Record<string, string>
  labels: Record<string, string>
} {
  return {
    secrets: { [SECRET_ENV]: secretName },
    labels: { [OPENCODE_SECRET_LABEL]: mountLabel(secretName) },
  }
}

/**
 * Mount `secretName` on `sandbox` for the turn about to start. Keeps whatever
 * configured secret is already mounted (e.g. one attached at creation) rather
 * than swapping it. Call as early in the send as possible, then
 * {@link waitForSecretPropagation} just before starting the agent.
 */
export async function mountSharedOpencodeSecret(
  sandbox: DaytonaSandbox,
  secretName: string
): Promise<MountedSecret> {
  const current = sandbox.labels?.[OPENCODE_SECRET_LABEL]
  const mountedName = current ? parseMountLabel(current) : undefined
  if (mountedName && getSharedOpencodeSecretNames().includes(mountedName)) {
    return { name: mountedName, readyAt: 0 }
  }

  await sandbox.updateSecrets({ [SECRET_ENV]: secretName })
  let readyAt = Date.now() + SECRET_PROPAGATION_MS
  if (!current) {
    // Created before secrets were in use: the mount only takes effect after a
    // restart. Files survive it; running processes (dev servers, terminals)
    // don't — acceptable once per sandbox.
    console.log(`[opencode-secrets] restarting sandbox ${sandbox.id} to enable secrets`)
    await sandbox.stop()
    await sandbox.start()
    readyAt = 0
  }
  await sandbox.setLabels({ ...sandbox.labels, [OPENCODE_SECRET_LABEL]: mountLabel(secretName) })
  return { name: secretName, readyAt }
}

/** Sleep until a freshly remounted secret has reached the proxy. */
export async function waitForSecretPropagation(mounted: MountedSecret): Promise<void> {
  const remaining = mounted.readyAt - Date.now()
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
}

/**
 * Point the agent at the mounted secret: drop the credential marker from its
 * `env` and add the inline config that tells OpenCode to read its key from
 * {@link SECRET_ENV}. Mutates `env`. A value the user set themselves (via
 * chat/repo env vars) is not a marker, so it is kept and wins as before.
 */
export function applySecretToAgentEnv(env: Record<string, string>): void {
  if (!parseSecretMarker(env[OPENCODE_KEY_ENV])) return
  delete env[OPENCODE_KEY_ENV]
  env.OPENCODE_CONFIG_CONTENT = AGENT_OPENCODE_CONFIG
}

function mountLabel(secretName: string): string {
  return `${SECRET_ENV}:${secretName}`
}

/** The secret named by a mount label, or undefined for any other value. */
function parseMountLabel(label: string): string | undefined {
  const prefix = `${SECRET_ENV}:`
  return label.startsWith(prefix) ? label.slice(prefix.length) || undefined : undefined
}

/**
 * Detach the shared OpenCode secret when a turn ends, so the placeholder left
 * in the sandbox stops working until the next turn mounts it again. Call it
 * BEFORE the chat is released back to "ready": sends are refused while the
 * chat is running, so the next turn's mount can never race this detach.
 *
 * A no-op (no API call) for sandboxes with nothing mounted. Never throws — a
 * failed detach leaves the placeholder live a while longer, which must not
 * fail the turn it follows.
 */
export async function releaseSharedOpencodeSecret(sandbox: DaytonaSandbox): Promise<void> {
  const current = sandbox.labels?.[OPENCODE_SECRET_LABEL]
  if (!current || current === DETACHED) return
  try {
    await sandbox.updateSecrets({})
    await sandbox.setLabels({ ...sandbox.labels, [OPENCODE_SECRET_LABEL]: DETACHED })
  } catch (err) {
    console.error(`[opencode-secrets] failed to detach secret from sandbox ${sandbox.id}:`, err)
  }
}
