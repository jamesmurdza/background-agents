/**
 * The Daytona secrets a turn mounts (server-only): the shared pool key it
 * draws on, if any (lib/server/shared-pool-secrets), and the user's own
 * provider keys (lib/server/user-key-secrets).
 *
 * The agent is handed each secret's placeholder in place of the credential
 * it stands for, so neither a pool key nor the user's own key ever enters
 * the sandbox. A placeholder works only while its secret is mounted, and
 * anything in the sandbox can use it then — the terminal, a plain curl —
 * bypassing metering. So the whole set is mounted only for the duration of a
 * turn: {@link mountTurnSecrets} at send time, {@link releaseTurnSecrets}
 * wherever a turn ends. The mechanics (the label that records the set,
 * restarts, rollback) live in @background-agents/sandbox-secrets.
 *
 * Secrets are mounted under names no CLI reads on its own, so a plain
 * `opencode` or `claude` in the sandbox terminal doesn't pick a key up; only
 * the agent's env carries the placeholders ({@link applyTurnSecretsToEnv}).
 */

import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { getEnvForModel, type Agent, type CredentialId, type CustomEndpoint } from "@background-agents/common"
import {
  forgetSecrets,
  mountSecrets,
  parseSecretMarker,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
  type MountOptions,
  type SecretMounts,
} from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import { sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import { ensureSharedPoolSecret, sharedPoolSecretForRun } from "@/lib/server/shared-pool-secrets"
import {
  USER_KEY_PROVIDERS,
  ensureUserKeySecret,
  userKeyMountEnv,
  userKeySecretName,
  userKeySecretsEnabled,
} from "@/lib/server/user-key-secrets"

/**
 * Sandbox label recording the mounted set: `<env var>:<secret name>` pairs
 * during a turn, `none` between turns, absent on sandboxes that have never
 * had a secret. Named for the first pool that used it; renaming it would make
 * every existing sandbox look secret-less and force a restart.
 */
export const TURN_SECRETS_LABEL = "opencode-secret"

const MOUNT_OPTIONS: MountOptions = { label: TURN_SECRETS_LABEL }

/** Other env vars getEnvForModel copies a credential into. */
const CREDENTIAL_ENV_ALIASES: Partial<Record<CredentialId, string[]>> = {
  GEMINI_API_KEY: ["GOOGLE_API_KEY"],
}

/** A secret a turn mounts, and the agent env value it stands in for. */
export interface TurnSecret {
  kind: "pool" | "user"
  credential: CredentialId
  /** Daytona secret name. */
  name: string
  /** Env var it is mounted as inside the sandbox. */
  mountEnv: string
  /**
   * What the agent env carries until it is swapped: a pool's credential
   * marker, or the user's own key.
   */
  envValue: string
}

export interface ReadyTurnSecret extends TurnSecret {
  /** What the agent is handed instead of {@link TurnSecret.envValue}. */
  placeholder: string
}

/**
 * The secrets a run would mount: the shared pool key it draws on, and every
 * enabled user key the agent's env would carry. Pure — call before the
 * sandbox exists so it can be created with them.
 */
export function planTurnSecrets(params: {
  userId: string
  agent: Agent
  model: string | undefined
  credentials: Credentials
  endpoints?: CustomEndpoint[]
}): TurnSecret[] {
  const { userId, agent, model, credentials, endpoints } = params
  const secrets: TurnSecret[] = []

  const poolSecret = sharedPoolSecretForRun(credentials, agent, model)
  const pool = poolSecret && sharedPoolForSecret(poolSecret)
  if (poolSecret && pool) {
    secrets.push({
      kind: "pool",
      credential: pool.envKey,
      name: poolSecret,
      mountEnv: pool.mountEnv,
      envValue: credentials[pool.envKey]!,
    })
  }

  const systemEnv = getEnvForModel(model, agent, credentials, endpoints)
  for (const [credential, value] of Object.entries(systemEnv)) {
    if (!userKeySecretsEnabled(credential) || parseSecretMarker(value)) continue
    // A custom endpoint's key goes to the endpoint, not the provider.
    if (pointsElsewhere(systemEnv, credential)) continue
    secrets.push({
      kind: "user",
      credential,
      name: userKeySecretName(userId, credential, value),
      mountEnv: userKeyMountEnv(credential),
      envValue: value,
    })
  }
  return secrets
}

/**
 * Make sure every planned secret exists, creating it if not, and resolve its
 * placeholder. Call before creating a sandbox with them or mounting them.
 * A pool secret that can't be ensured fails the turn: the shared key must
 * never fall back to the sandbox. A user key that can't is left out, so the
 * agent gets the key itself, as it did before secrets.
 */
export async function ensureTurnSecrets(
  daytona: Daytona,
  userId: string,
  secrets: TurnSecret[]
): Promise<ReadyTurnSecret[]> {
  const ready: ReadyTurnSecret[] = []
  for (const secret of secrets) {
    if (secret.kind === "pool") {
      const { placeholder } = await ensureSharedPoolSecret(daytona, secret.name)
      ready.push({ ...secret, placeholder })
      continue
    }
    try {
      const { placeholder } = await ensureUserKeySecret(daytona, userId, secret.credential, secret.envValue)
      ready.push({ ...secret, placeholder })
    } catch (err) {
      console.error(`[turn-secrets] passing ${secret.credential} unprotected; its secret failed:`, err)
    }
  }
  return ready
}

/** Whether `env` sends `credential` to a server other than its provider's. */
function pointsElsewhere(env: Record<string, string>, credential: CredentialId): boolean {
  return !!USER_KEY_PROVIDERS[credential]?.baseUrlEnv?.some((key) => env[key])
}

function mountsOf(secrets: TurnSecret[]): SecretMounts {
  return Object.fromEntries(secrets.map((s) => [s.mountEnv, s.name]))
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
  return secretsCreateParams(mountsOf(secrets), MOUNT_OPTIONS)
}

/**
 * Mount exactly `secrets` on `sandbox` for the turn about to start (a no-op
 * when they already are), detaching whatever else is. Call as early in the
 * send as possible, then {@link waitForTurnSecrets} just before starting the
 * agent. With nothing to mount it only detaches leftovers, so a sandbox that
 * never needed secrets is never restarted for them.
 */
export async function mountTurnSecrets(
  sandbox: DaytonaSandbox,
  secrets: ReadyTurnSecret[]
): Promise<{ readyAt: number }> {
  if (secrets.length === 0) {
    await releaseTurnSecrets(sandbox)
    return { readyAt: 0 }
  }
  try {
    return await mountSecrets(sandbox, mountsOf(secrets), MOUNT_OPTIONS)
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
 * carries the credential the secret stands for (aliases like GOOGLE_API_KEY
 * included), and drop every pool marker left: no secret backs it, and an
 * agent given every key it might use (Droid) must not be handed a dead one.
 * Mutates `env`; call for every run, `secrets` or not.
 *
 * A value the user set themselves (via chat/repo env vars) isn't one of
 * these, so it is kept and wins as before. A user's own key also stays as is
 * when the env points its provider at another server (see
 * USER_KEY_PROVIDERS' `baseUrlEnv`), where the placeholder wouldn't be swapped.
 */
export function applyTurnSecretsToEnv(env: Record<string, string>, secrets: ReadyTurnSecret[]): void {
  for (const secret of secrets) {
    if (secret.kind === "user" && pointsElsewhere(env, secret.credential)) continue
    for (const key of [secret.credential, ...(CREDENTIAL_ENV_ALIASES[secret.credential] ?? [])]) {
      if (env[key] === secret.envValue) env[key] = secret.placeholder
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
 * sandbox stop working until the next turn mounts them again. Call it BEFORE
 * the chat is released back to "ready": sends are refused while the chat is
 * running, so the next turn's mount can never race this detach. A no-op for
 * sandboxes with nothing mounted; never throws.
 */
export function releaseTurnSecrets(sandbox: DaytonaSandbox): Promise<void> {
  return releaseSecrets(sandbox, MOUNT_OPTIONS)
}
