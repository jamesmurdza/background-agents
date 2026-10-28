/**
 * Shared pool keys via Daytona secrets (server-only).
 *
 * A shared pool key (see lib/server/shared-key-pools) is never handed to a
 * sandbox. Instead a Daytona secret is mounted on it as the pool's
 * `mountEnv`: the sandbox sees only an opaque placeholder, and Daytona's
 * egress proxy substitutes the real key on HTTPS requests to the pool's
 * hosts. Printing the env, reading `/proc/<pid>/environ` or running `ps aux`
 * inside the sandbox reveals nothing usable outside it. The mechanics
 * (mounting, the label that records it, restarts, rollback) live in
 * @background-agents/sandbox-secrets; this module decides what to mount.
 *
 * The secret is mounted under a name no CLI reads on its own, so a plain
 * `opencode` or `gemini` in the sandbox terminal doesn't pick the key up.
 * Only the agent's process is handed the placeholder, in place of the
 * credential marker it would otherwise get (see {@link applyPoolSecretToEnv}).
 * The placeholder is the same in every sandbox, so it can go in the env as is.
 *
 * The placeholder still works from anywhere INSIDE the sandbox while mounted —
 * the terminal, a plain curl — and that traffic bypasses metering. So the
 * secret is mounted only for the duration of a turn: {@link mountSharedPoolSecret}
 * at send time, {@link releaseSharedPoolSecrets} wherever a turn ends. Between
 * turns the placeholder is dead weight; the proxy no longer swaps it.
 *
 * The secrets themselves are created from the pool's env var on first use
 * ({@link ensureSharedPoolSecret}), so there is nothing to set up in the
 * Daytona dashboard.
 */

import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { modelRequiresKey, type Agent } from "@background-agents/common"
import {
  ensureSecret,
  mountSecrets,
  parseSecretMarker,
  readMounts,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
  type EnsuredSecret,
  type MountOptions,
} from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import {
  getSharedSecretNames,
  sharedKeyForSecret,
  sharedPoolForProvider,
  sharedPoolForSecret,
  type SharedKeyPool,
  type SharedPoolId,
} from "@/lib/server/shared-key-pools"

/**
 * Sandbox label recording the mounted secrets: `<env var>:<secret name>`
 * during a turn, `none` between turns, absent on sandboxes that have never had
 * a secret. Named for the first pool that used it; renaming it would make
 * every existing sandbox look secret-less and force a restart.
 */
export const SHARED_POOL_SECRET_LABEL = "opencode-secret"

const MOUNT_OPTIONS: MountOptions = { label: SHARED_POOL_SECRET_LABEL }

export interface MountedPoolSecret {
  pool: SharedPoolId
  /** The secret now mounted — the key id to attribute this turn's usage to. */
  name: string
  /** What the agent is handed instead of the key. */
  placeholder: string
  /** Epoch ms after which the proxy can be relied on to recognise it. */
  readyAt: number
}

function requirePool(secretName: string): SharedKeyPool {
  const pool = sharedPoolForSecret(secretName)
  if (!pool) throw new Error(`Secret ${secretName} belongs to no shared key pool`)
  return pool
}

/**
 * The secret this run would mount, or undefined when the run doesn't draw on
 * a shared pool (own key, free model, a provider without a pool).
 */
export function sharedPoolSecretForRun(
  credentials: Credentials,
  agent: Agent,
  model: string | undefined
): string | undefined {
  const pool = sharedPoolForProvider(modelRequiresKey(agent, model))
  return pool && parseSecretMarker(credentials[pool.envKey])
}

/**
 * Make sure the Daytona secret `secretName` exists, creating it from the pool
 * key it was derived from if not, and return its placeholder. Call before
 * creating a sandbox with the secret or mounting it. Throws if the secret
 * can't be confirmed or created, e.g. when the Daytona API key lacks
 * permission to manage secrets.
 */
export async function ensureSharedPoolSecret(daytona: Daytona, secretName: string): Promise<EnsuredSecret> {
  const pool = requirePool(secretName)
  return ensureSecret(daytona, {
    name: secretName,
    value: () => {
      const key = sharedKeyForSecret(secretName)
      if (!key) throw new Error(`No configured ${pool.label} key matches secret ${secretName}`)
      return key
    },
    hosts: pool.hosts,
    description: `Shared ${pool.label} key, created by background-agents`,
  })
}

/**
 * `daytona.create` params that mount `secretName` from the start, so the new
 * sandbox never needs the restart a later first mount would force.
 */
export function sharedPoolSecretCreateParams(secretName: string): {
  secrets: Record<string, string>
  labels: Record<string, string>
} {
  return secretsCreateParams({ [requirePool(secretName).mountEnv]: secretName }, MOUNT_OPTIONS)
}

/**
 * Mount `secretName` on `sandbox` for the turn about to start, detaching any
 * other pool's secret. Keeps whatever configured secret of the same pool is
 * already mounted (e.g. one attached at creation) rather than swapping it.
 * Call as early in the send as possible, then {@link waitForPoolSecret} just
 * before starting the agent.
 */
export async function mountSharedPoolSecret(
  sandbox: DaytonaSandbox,
  daytona: Daytona,
  secretName: string
): Promise<MountedPoolSecret> {
  const pool = requirePool(secretName)
  const mountedName = readMounts(sandbox, MOUNT_OPTIONS).mounts?.[pool.mountEnv]
  const name = mountedName && getSharedSecretNames(pool).includes(mountedName) ? mountedName : secretName
  const { placeholder } = await ensureSharedPoolSecret(daytona, name)
  const { readyAt } = await mountSecrets(sandbox, { [pool.mountEnv]: name }, MOUNT_OPTIONS)
  return { pool: pool.id, name, placeholder, readyAt }
}

/** Sleep until a freshly mounted secret has reached the proxy. */
export function waitForPoolSecret(mounted: MountedPoolSecret): Promise<void> {
  return waitForPropagation(mounted)
}

/**
 * Hand the agent the mounted secret's placeholder wherever its `env` carries
 * a credential marker for that pool (aliases like GOOGLE_API_KEY included),
 * and drop every other marker: no secret backs it, and an agent that is given
 * every key it might use (Droid) must not be handed a dead one. Mutates `env`.
 * Call for every run, `mounted` or not. A value the user set themselves (via
 * chat/repo env vars) is not a marker, so it is kept and wins as before.
 */
export function applyPoolSecretToEnv(env: Record<string, string>, mounted: MountedPoolSecret | undefined): void {
  for (const [key, value] of Object.entries(env)) {
    const secretName = parseSecretMarker(value)
    if (!secretName) continue
    if (mounted && sharedPoolForSecret(secretName)?.id === mounted.pool) env[key] = mounted.placeholder
    else delete env[key]
  }
}

/**
 * Detach the shared pool secret when a turn ends, so the placeholder left in
 * the sandbox stops working until the next turn mounts it again. Call it
 * BEFORE the chat is released back to "ready": sends are refused while the
 * chat is running, so the next turn's mount can never race this detach.
 * A no-op for sandboxes with nothing mounted; never throws.
 */
export function releaseSharedPoolSecrets(sandbox: DaytonaSandbox): Promise<void> {
  return releaseSecrets(sandbox, MOUNT_OPTIONS)
}
