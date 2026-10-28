/**
 * The Daytona secrets a turn mounts (server-only): the shared pool key it
 * draws on, if any (lib/server/shared-pool-secrets), the user's own provider
 * keys (lib/server/user-key-secrets), the selected custom endpoint's
 * credentials (lib/server/endpoint-secrets) and the env vars the user marked
 * as secrets (lib/server/env-var-secrets).
 *
 * The agent is handed each secret's placeholder in place of the credential
 * it stands for, so neither a pool key nor the user's own key ever enters
 * the sandbox. A placeholder works only while its secret is mounted, and
 * anything in the sandbox can use it then — the terminal, a plain curl —
 * bypassing metering. So keys are mounted only for the duration of a turn:
 * {@link mountTurnSecrets} at send time, {@link releaseTurnSecrets} wherever a
 * turn ends. Secret env vars are the exception: they are pinned, staying
 * mounted between turns so dev servers keep working. The mechanics (the label that records the set,
 * restarts, rollback) live in @background-agents/sandbox-secrets.
 *
 * Keys are mounted under names no CLI reads on its own, so a plain
 * `opencode` or `claude` in the sandbox terminal doesn't pick a key up; only
 * the agent's env carries the placeholders ({@link applyTurnSecretsToEnv}).
 * A secret env var is mounted under its own name, as the user asked for it.
 */

import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { findEndpoint, getEnvForModel, type Agent, type CustomEndpoint } from "@background-agents/common"
import {
  ensureSecret,
  forgetSecrets,
  mountSecrets,
  parseSecretMarker,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
  type EnsureSecretSpec,
  type MountOptions,
  type SecretMounts,
} from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import { envVarSecretSpec, envVarSecretsEnabled, type UserEnvVars } from "@/lib/server/env-var-secrets"
import {
  endpointCredentials,
  endpointSecretHost,
  endpointSecretSpec,
  endpointSecretsEnabled,
} from "@/lib/server/endpoint-secrets"
import { sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import { ensureSharedPoolSecret, sharedPoolSecretForRun } from "@/lib/server/shared-pool-secrets"
import {
  USER_KEY_PROVIDERS,
  userKeyMountEnv,
  userKeySecretSpec,
  userKeySecretsEnabled,
} from "@/lib/server/user-key-secrets"

/**
 * Sandbox label recording the mounted set: `<env var>:<secret name>` pairs
 * during a turn, `none` between turns, absent on sandboxes that have never
 * had a secret. Named for the first pool that used it; renaming it would make
 * every existing sandbox look secret-less and force a restart.
 */
export const TURN_SECRETS_LABEL = "opencode-secret"

/** Sandbox label recording the pinned part of the mounted set (secret env vars). */
export const PINNED_SECRETS_LABEL = "pinned-secrets"

const MOUNT_OPTIONS: MountOptions = { label: TURN_SECRETS_LABEL, pinnedLabel: PINNED_SECRETS_LABEL }

/** A secret a turn mounts, and the agent env value it stands in for. */
export interface TurnSecret {
  /** "env" secrets are pinned: they stay mounted between turns. */
  kind: "pool" | "user" | "endpoint" | "env"
  /** Daytona secret name. */
  name: string
  /** Env var it is mounted as inside the sandbox. */
  mountEnv: string
  /**
   * What the agent env carries until it is swapped: a pool's credential
   * marker, the user's own key, a custom endpoint's credential, or a secret
   * env var's value.
   */
  envValue: string
  /**
   * The agent env vars carrying {@link envValue}, whole (a key and its
   * aliases) or inside a larger value (an endpoint's header blob).
   */
  envKeys: string[]
  /** How to create a user, endpoint or env secret; a pool's comes from its pool. */
  spec?: EnsureSecretSpec
  /**
   * Env vars that, when the agent env sets one, send the value to a server
   * other than the secret's hosts, where a placeholder would never be
   * swapped. The value then stays as is.
   */
  bypassEnv?: string[]
}

export interface ReadyTurnSecret extends TurnSecret {
  /** What the agent is handed instead of {@link TurnSecret.envValue}. */
  placeholder: string
}

/**
 * The secrets a run would mount: the shared pool key it draws on, every
 * enabled user key the agent's env would carry, or the selected custom
 * endpoint's credentials, plus the user's secret env vars. Pure — call before
 * the sandbox exists so it can be created with them.
 */
export function planTurnSecrets(params: {
  userId: string
  agent: Agent
  model: string | undefined
  credentials: Credentials
  endpoints?: CustomEndpoint[]
  envVars?: UserEnvVars
}): TurnSecret[] {
  const { userId, envVars } = params
  const secrets = planKeySecrets(params)
  if (envVars && envVarSecretsEnabled()) {
    for (const envVar of envVars.secrets) {
      const spec = envVarSecretSpec(userId, envVar)
      secrets.push({ kind: "env", name: spec.name, mountEnv: envVar.key, envValue: envVar.value, envKeys: [envVar.key], spec })
    }
  }
  return secrets
}

function planKeySecrets(params: {
  userId: string
  agent: Agent
  model: string | undefined
  credentials: Credentials
  endpoints?: CustomEndpoint[]
}): TurnSecret[] {
  const { userId, agent, model, credentials, endpoints } = params
  const systemEnv = getEnvForModel(model, agent, credentials, endpoints)
  const carrying = (value: string) => Object.keys(systemEnv).filter((key) => systemEnv[key].includes(value))
  const secrets: TurnSecret[] = []

  const poolSecret = sharedPoolSecretForRun(credentials, agent, model)
  const pool = poolSecret && sharedPoolForSecret(poolSecret)
  if (poolSecret && pool) {
    const marker = credentials[pool.envKey]!
    secrets.push({ kind: "pool", name: poolSecret, mountEnv: pool.mountEnv, envValue: marker, envKeys: carrying(marker) })
  }

  // A custom endpoint's env holds its own credentials and no provider keys.
  const endpoint = findEndpoint(model, endpoints)
  if (endpoint) {
    const host = endpointSecretHost(endpoint.baseUrl)
    if (!host || !endpointSecretsEnabled()) return secrets
    endpointCredentials(endpoint).forEach((value, i) => {
      const envKeys = carrying(value)
      if (envKeys.length === 0) return
      const spec = endpointSecretSpec(userId, host, value)
      secrets.push({ kind: "endpoint", name: spec.name, mountEnv: `ENDPOINT_SECRET_${i + 1}`, envValue: value, envKeys, spec })
    })
    return secrets
  }

  for (const [credential, value] of Object.entries(systemEnv)) {
    if (!userKeySecretsEnabled(credential) || parseSecretMarker(value)) continue
    const spec = userKeySecretSpec(userId, credential, value)
    secrets.push({
      kind: "user",
      name: spec.name,
      mountEnv: userKeyMountEnv(credential),
      envValue: value,
      envKeys: carrying(value),
      spec,
      bypassEnv: USER_KEY_PROVIDERS[credential]?.baseUrlEnv,
    })
  }
  return secrets
}

/**
 * Make sure every planned secret exists, creating it if not, and resolve its
 * placeholder. Call before creating a sandbox with them or mounting them.
 * A pool secret that can't be ensured fails the turn: the shared key must
 * never fall back to the sandbox. A user's own secret that can't is left
 * out, so the agent gets the value itself, as it did before secrets.
 */
export async function ensureTurnSecrets(daytona: Daytona, secrets: TurnSecret[]): Promise<ReadyTurnSecret[]> {
  const ready: ReadyTurnSecret[] = []
  for (const secret of secrets) {
    if (!secret.spec) {
      const { placeholder } = await ensureSharedPoolSecret(daytona, secret.name)
      ready.push({ ...secret, placeholder })
      continue
    }
    try {
      const { placeholder } = await ensureSecret(daytona, secret.spec)
      ready.push({ ...secret, placeholder })
    } catch (err) {
      console.error(`[turn-secrets] passing ${secret.envKeys.join(", ")} unprotected; its secret failed:`, err)
    }
  }
  return ready
}

function mountsOf(secrets: TurnSecret[]): SecretMounts {
  return Object.fromEntries(secrets.map((s) => [s.mountEnv, s.name]))
}

/** `secrets` split into the turn's own and the pinned (env) ones. */
function splitPinned(secrets: TurnSecret[]): { turn: SecretMounts; pinned: SecretMounts } {
  return {
    turn: mountsOf(secrets.filter((s) => s.kind !== "env")),
    pinned: mountsOf(secrets.filter((s) => s.kind === "env")),
  }
}

/**
 * `daytona.create` params that mount `secrets` from the start, so the new
 * sandbox never needs the restart a later first mount would force. Undefined
 * when there is nothing to mount.
 */
export function turnSecretsCreateParams(
  secrets: TurnSecret[]
): { secrets: Record<string, string>; labels: Record<string, string> } | undefined {
  if (secrets.length === 0) return undefined
  const { turn, pinned } = splitPinned(secrets)
  return secretsCreateParams(turn, MOUNT_OPTIONS, pinned)
}

/**
 * Mount exactly `secrets` on `sandbox` for the turn about to start (a no-op
 * when they already are), detaching whatever else is, pinned env secrets the
 * user has since removed included. Call as early in the send as possible,
 * then {@link waitForTurnSecrets} just before starting the agent. With
 * nothing to mount it only detaches leftovers, so a sandbox that never
 * needed secrets is never restarted for them.
 */
export async function mountTurnSecrets(
  sandbox: DaytonaSandbox,
  secrets: ReadyTurnSecret[]
): Promise<{ readyAt: number }> {
  if (secrets.length === 0) {
    await releaseSecrets(sandbox, MOUNT_OPTIONS, {})
    return { readyAt: 0 }
  }
  const { turn, pinned } = splitPinned(secrets)
  try {
    return await mountSecrets(sandbox, turn, MOUNT_OPTIONS, pinned)
  } catch (err) {
    // A user may have deleted one (by changing a key) since this process
    // last saw it; look again next turn.
    forgetSecrets(secrets.map((s) => s.name))
    throw err
  }
}

/** Sleep until freshly mounted secrets have reached the proxy. */
export function waitForTurnSecrets(mounted: { readyAt: number }): Promise<void> {
  return waitForPropagation(mounted)
}

/**
 * Hand the agent each mounted secret's placeholder wherever its `env`
 * carries the value the secret stands for (aliases like GOOGLE_API_KEY and
 * endpoint header blobs included), and drop every pool marker left: no
 * secret backs it, and an agent given every key it might use (Droid) must
 * not be handed a dead one. Mutates `env`; call for every run, `secrets` or
 * not.
 *
 * A value the user set themselves (via chat/repo env vars) isn't one of
 * these unless they marked it as a secret, so it is kept and wins as before. A user's own key also stays as is
 * when the env points its provider at another server (see `bypassEnv`).
 */
export function applyTurnSecretsToEnv(env: Record<string, string>, secrets: ReadyTurnSecret[]): void {
  for (const secret of secrets) {
    if (secret.bypassEnv?.some((key) => env[key])) continue
    for (const key of secret.envKeys) {
      if (env[key]?.includes(secret.envValue)) env[key] = env[key].split(secret.envValue).join(secret.placeholder)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (parseSecretMarker(value)) delete env[key]
  }
}

/** The pool secret among `secrets` — the key id to attribute the turn's usage to. */
export function poolSecretOf(secrets: TurnSecret[]): string | undefined {
  return secrets.find((s) => s.kind === "pool")?.name
}

/**
 * Detach every turn secret when a turn ends, so the placeholders left in the
 * sandbox stop working until the next turn mounts them again. Pinned env
 * secrets stay. Call it BEFORE
 * the chat is released back to "ready": sends are refused while the chat is
 * running, so the next turn's mount can never race this detach. A no-op for
 * sandboxes with nothing mounted; never throws.
 */
export function releaseTurnSecrets(sandbox: DaytonaSandbox): Promise<void> {
  return releaseSecrets(sandbox, MOUNT_OPTIONS)
}
