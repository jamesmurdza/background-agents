/**
 * The Daytona secrets a turn mounts (server-only): the shared pool key it
 * draws on, if any (lib/server/shared-pool-secrets), the user's own provider
 * keys (lib/server/user-key-secrets) and subscription access tokens
 * (lib/server/subscription-secrets).
 *
 * The agent is handed each secret's placeholder in place of the credential
 * it stands for, so neither a pool key nor the user's own key ever enters
 * the sandbox. A placeholder works only while its secret is mounted, and
 * anything in the sandbox can use it then — the terminal, a plain curl —
 * bypassing metering. So keys are mounted only for the duration of a turn:
 * {@link mountTurnSecrets} at send time, {@link releaseTurnSecrets} wherever a
 * turn ends. Only {@link KEEPALIVE_SECRET} stays mounted between turns
 * (pinned). The mechanics (the label that records the set, restarts,
 * rollback) live in @background-agents/sandbox-secrets.
 *
 * Keys are mounted under names no CLI reads on its own, so a plain
 * `opencode` or `claude` in the sandbox terminal doesn't pick a key up; only
 * the agent's env carries the placeholders ({@link applyTurnSecretsToEnv}).
 */

import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { findEndpoint, getEnvForModel, type Agent, type CustomEndpoint } from "@background-agents/common"
import {
  ensureSecret,
  forgetSecrets,
  mountSecrets,
  parseSecretMarker,
  readMounts,
  readPinned,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
  type EnsureSecretSpec,
  type MountOptions,
  type SecretMounts,
} from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import { isSharedKey, sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import {
  CLAUDE_SHARED_MOUNT_ENV,
  claudeRunSecretSpec,
  codexAccessToken,
  codexSecretSpec,
  subscriptionSecretsEnabled,
  type ClaudeRunToken,
} from "@/lib/server/subscription-secrets"
import { ensureSharedPoolSecret, sharedPoolSecretForRun } from "@/lib/server/shared-pool-secrets"
import {
  USER_KEY_PROVIDERS,
  userKeyMountEnv,
  userKeySecretSpec,
  userKeySecretsEnabled,
} from "@/lib/server/user-key-secrets"

/**
 * Sandbox label recording the mounted set: `<env var>:<secret name>` pairs
 * during a turn, only the pinned ones (or `none`) between turns, absent on
 * sandboxes that have never had a secret. Named for the first pool that used
 * it; renaming it would make every existing sandbox look secret-less and
 * force a restart.
 */
export const TURN_SECRETS_LABEL = "opencode-secret"

/** Sandbox label recording the pinned part of the mounted set (secret env vars). */
export const PINNED_SECRETS_LABEL = "pinned-secrets"

const MOUNT_OPTIONS: MountOptions = { label: TURN_SECRETS_LABEL, pinnedLabel: PINNED_SECRETS_LABEL }

/**
 * A secret pinned on every sandbox that has secrets, and never detached.
 * Daytona wires a sandbox's secrets proxy at boot only when some secret is
 * attached, so one stopped between turns with none would come back without
 * it and send placeholders out unswapped (mountSecrets then has to restart
 * it). Holds no credential, and its host never resolves.
 */
export const KEEPALIVE_SECRET: EnsureSecretSpec = {
  name: "sandbox_keepalive",
  value: () => "keepalive",
  hosts: ["keepalive.invalid"],
  description: "Keeps a sandbox's secrets proxy across restarts; holds no credential",
}
export const KEEPALIVE_MOUNT_ENV = "SESSION_RELAY_TOKEN_KEEPALIVE"

/** A secret a turn mounts, and the agent env value it stands in for. */
export interface TurnSecret {
  /**
   * Only "keepalive" ({@link KEEPALIVE_SECRET}) is pinned: it stays mounted
   * between turns. "claude" is the Claude subscription token, the
   * shared pool's or the user's own, which the agent fetches itself (see {@link mountClaudeSecret}) rather than
   * finding in its env.
   */
  kind: "pool" | "user" | "claude" | "keepalive"
  /** Daytona secret name. */
  name: string
  /** Env var it is mounted as inside the sandbox. */
  mountEnv: string
  /**
   * What the agent env carries until it is swapped: a pool's credential
   * marker, or the user's own key or subscription token.
   */
  envValue: string
  /**
   * The agent env vars carrying {@link envValue}, whole (a key and its
   * aliases) or inside a larger value (Codex's auth.json). Empty for the shared Claude token.
   */
  envKeys: string[]
  /** How to create the secret; a pool's comes from its pool. */
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
 * enabled user key the agent's env would carry, plus the Claude token. None
 * for a custom endpoint, whose credentials go into the sandbox as before.
 * Pure — call before the sandbox exists so it can be created with them.
 */
export function planTurnSecrets(params: {
  userId: string
  agent: Agent
  model: string | undefined
  credentials: Credentials
  endpoints?: CustomEndpoint[]
  /** The Claude access token the run fetches (shared or its own subscription's), if any. */
  claudeToken?: ClaudeRunToken
}): TurnSecret[] {
  const { userId, claudeToken } = params
  const secrets = planKeySecrets(params)
  const claudeSpec = claudeToken && claudeRunSecretSpec(userId, claudeToken)
  if (claudeToken && claudeSpec) {
    secrets.push({ kind: "claude", name: claudeSpec.name, mountEnv: CLAUDE_SHARED_MOUNT_ENV, envValue: claudeToken.token, envKeys: [], spec: claudeSpec })
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

  // A custom endpoint's env holds its own credentials, under provider key
  // names but for another server, and no provider keys.
  if (findEndpoint(model, endpoints)) return secrets

  for (const [credential, value] of Object.entries(systemEnv)) {
    if (credential === "CODEX_CREDENTIALS" && subscriptionSecretsEnabled("CODEX_CREDENTIALS")) {
      // A rendered auth.json: only its access token is a usable credential
      // (the refresh token in it is already a stand-in).
      const token = codexAccessToken(value)
      if (!token) continue
      const spec = codexSecretSpec(userId, token)
      secrets.push({ kind: "user", name: spec.name, mountEnv: userKeyMountEnv(credential), envValue: token, envKeys: carrying(token), spec })
      continue
    }
    // A pool key arrives raw only with the pool's secrets turned off: it isn't the user's.
    if (!userKeySecretsEnabled(credential) || parseSecretMarker(value) || isSharedKey(credential, value)) continue
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
 * out, so the agent gets the value itself, as it did before secrets. With
 * anything to mount, {@link KEEPALIVE_SECRET} is added too.
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
      console.error(`[turn-secrets] passing ${secret.envKeys.join(", ") || secret.mountEnv} unprotected; its secret failed:`, err)
    }
  }
  if (ready.length > 0) {
    try {
      const { name, placeholder } = await ensureSecret(daytona, KEEPALIVE_SECRET)
      ready.push({ kind: "keepalive", name, mountEnv: KEEPALIVE_MOUNT_ENV, envValue: "", envKeys: [], placeholder })
    } catch (err) {
      // Only a later stop/start costs a restart without it (see mountSecrets).
      console.error("[turn-secrets] mounting without the keepalive secret; it failed:", err)
    }
  }
  return ready
}

function mountsOf(secrets: TurnSecret[]): SecretMounts {
  return Object.fromEntries(secrets.map((s) => [s.mountEnv, s.name]))
}

const isPinned = (secret: TurnSecret) => secret.kind === "keepalive"

/** `secrets` split into the turn's own and the pinned (keepalive) ones. */
function splitPinned(secrets: TurnSecret[]): { turn: SecretMounts; pinned: SecretMounts } {
  return {
    turn: mountsOf(secrets.filter((s) => !isPinned(s))),
    pinned: mountsOf(secrets.filter(isPinned)),
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
 * when they already are), detaching whatever else is, pinned secrets other
 * than the keepalive included. Call as early in the send as possible,
 * then {@link waitForTurnSecrets} just before starting the agent. With
 * nothing to mount it only detaches leftovers (the keepalive stays), so a
 * sandbox that never needed secrets is never restarted for them.
 */
export async function mountTurnSecrets(
  sandbox: DaytonaSandbox,
  secrets: ReadyTurnSecret[]
): Promise<{ readyAt: number }> {
  if (secrets.length === 0) {
    // Keep the keepalive, which needs no ensuring: it is already mounted.
    const keepalive = readPinned(sandbox, MOUNT_OPTIONS)[KEEPALIVE_MOUNT_ENV]
    await releaseSecrets(sandbox, MOUNT_OPTIONS, keepalive ? { [KEEPALIVE_MOUNT_ENV]: keepalive } : {})
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
 * Codex's auth.json included), and drop every pool marker left: no
 * secret backs it, and an agent given every key it might use (Droid) must
 * not be handed a dead one. Mutates `env`; call for every run, `secrets` or
 * not.
 *
 * A value the user set themselves (via chat/repo env vars) isn't one of
 * these, so it is kept and wins as before. A user's own key also stays as is
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

/**
 * The placeholder to hand `userId`'s Claude run for `run`'s token (shared or
 * their own), mounting its secret on the run's sandbox first if a turn
 * started on an older token (the token refreshed mid-turn). Undefined when
 * the run should get the token itself: the feature is off, the secret
 * failed, or the sandbox has no secrets enabled, since enabling them
 * restarts it and would kill the run. Never throws.
 */
export async function mountClaudeSecret(
  daytona: Daytona,
  sandboxId: string,
  userId: string,
  run: ClaudeRunToken
): Promise<string | undefined> {
  const spec = claudeRunSecretSpec(userId, run)
  if (!spec) return undefined
  try {
    const { name, placeholder } = await ensureSecret(daytona, spec)
    const sandbox = await daytona.get(sandboxId)
    const { enabled, mounts } = readMounts(sandbox, MOUNT_OPTIONS)
    if (!enabled) return undefined
    if (mounts?.[CLAUDE_SHARED_MOUNT_ENV] === name) return placeholder
    const pinned = readPinned(sandbox, MOUNT_OPTIONS)
    const turn = Object.fromEntries(Object.entries(mounts ?? {}).filter(([env]) => !(env in pinned)))
    await waitForPropagation(await mountSecrets(sandbox, { ...turn, [CLAUDE_SHARED_MOUNT_ENV]: name }, MOUNT_OPTIONS, pinned))
    return placeholder
  } catch (err) {
    console.error(`[turn-secrets] passing the ${run.source} Claude token unprotected; its secret failed:`, err)
    return undefined
  }
}

/** The pool secret among `secrets` — the key id to attribute the turn's usage to. */
export function poolSecretOf(secrets: TurnSecret[]): string | undefined {
  return secrets.find((s) => s.kind === "pool")?.name
}

/**
 * Detach every turn secret when a turn ends, so the placeholders left in the
 * sandbox stop working until the next turn mounts them again. The pinned
 * keepalive stays. Call it BEFORE
 * the chat is released back to "ready": sends are refused while the chat is
 * running, so the next turn's mount can never race this detach. A no-op for
 * sandboxes with nothing mounted; never throws.
 */
export function releaseTurnSecrets(sandbox: DaytonaSandbox): Promise<void> {
  return releaseSecrets(sandbox, MOUNT_OPTIONS)
}
