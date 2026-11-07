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
 * turn ends. The mechanics (the keepalive, restart-on-proxy-lost) live in
 * @background-agents/sandbox-secrets' `setSecrets`.
 *
 * Keys are mounted under names no CLI reads on its own, so a plain
 * `opencode` or `claude` in the sandbox terminal doesn't pick a key up; only
 * the agent's env carries the placeholders ({@link applyTurnSecretsToEnv}).
 */

import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { findEndpoint, getEnvForModel, type Agent, type CustomEndpoint } from "@background-agents/common"
import { ensureSecret, parseSecretMarker, secretName, setSecrets } from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import { isSharedKey, sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import {
  CLAUDE_SECRET_HOSTS,
  CLAUDE_SHARED_MOUNT_ENV,
  codexAccessToken,
  subscriptionSecretsEnabled,
  type ClaudeRunToken,
} from "@/lib/server/subscription-secrets"
import { ensureSharedPoolSecret, sharedPoolSecretForRun } from "@/lib/server/shared-pool-secrets"
import {
  USER_KEY_PROVIDERS,
  userKeyMountEnv,
  userKeySecretsEnabled,
  type UserKeyProvider,
} from "@/lib/server/user-key-secrets"

/** A secret a turn mounts, and the agent env value it stands in for. */
export interface TurnSecret {
  /**
   * "claude" is the Claude subscription token, the shared pool's or the
   * user's own, which the agent fetches itself (see {@link mountClaudeSecret})
   * rather than finding in its env.
   */
  kind: "pool" | "user" | "claude"
  /** The credential value the secret is derived from. */
  value: string
  /** Hosts the value may be sent to; omit to leave the secret unrestricted. */
  hosts?: string[]
  /** Env var it is mounted as inside the sandbox. */
  mountEnv: string
  /**
   * The agent env vars carrying {@link value}, whole (a key and its
   * aliases) or inside a larger value (Codex's auth.json). Empty for the shared Claude token.
   */
  envKeys: string[]
  /**
   * Env vars that, when the agent env sets one, send the value to a server
   * other than the secret's hosts, where a placeholder would never be
   * swapped. The value then stays as is.
   */
  bypassEnv?: string[]
  /**
   * The shared pool's own secret name, for secrets whose value doesn't
   * create the secret itself (see {@link sharedPoolSecretForRun}).
   */
  poolSecretName?: string
}

export interface ReadyTurnSecret extends TurnSecret {
  /** Daytona secret name mounted for this value. */
  name: string
  /** What the agent is handed instead of {@link TurnSecret.value}. */
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
  const { claudeToken } = params
  const secrets = planKeySecrets(params)
  if (claudeToken) {
    const claudeSecretEnabled =
      claudeToken.source === "shared" ? subscriptionSecretsEnabled("CLAUDE_SHARED") : subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")
    if (claudeSecretEnabled) {
      secrets.push({ kind: "claude", value: claudeToken.token, hosts: CLAUDE_SECRET_HOSTS, mountEnv: CLAUDE_SHARED_MOUNT_ENV, envKeys: [] })
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
  const { agent, model, credentials, endpoints } = params
  const systemEnv = getEnvForModel(model, agent, credentials, endpoints)
  const carrying = (value: string) => Object.keys(systemEnv).filter((key) => systemEnv[key].includes(value))
  const secrets: TurnSecret[] = []

  const poolSecret = sharedPoolSecretForRun(credentials, agent, model)
  const pool = poolSecret && sharedPoolForSecret(poolSecret)
  if (poolSecret && pool) {
    const marker = credentials[pool.envKey]!
    secrets.push({ kind: "pool", value: marker, mountEnv: pool.mountEnv, envKeys: carrying(marker), poolSecretName: poolSecret })
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
      secrets.push({
        kind: "user",
        value: token,
        hosts: ["chatgpt.com", "*.chatgpt.com"],
        mountEnv: userKeyMountEnv(credential),
        envKeys: carrying(token),
      })
      continue
    }
    // A pool key arrives raw only with the pool's secrets turned off: it isn't the user's.
    if (!userKeySecretsEnabled(credential) || parseSecretMarker(value) || isSharedKey(credential, value)) continue
    const provider: UserKeyProvider | undefined = USER_KEY_PROVIDERS[credential]
    secrets.push({
      kind: "user",
      value,
      hosts: provider?.hosts,
      mountEnv: userKeyMountEnv(credential),
      envKeys: carrying(value),
      bypassEnv: provider?.baseUrlEnv,
    })
  }
  return secrets
}

/**
 * Make sure every planned secret exists, creating it if not, and resolve its
 * name and placeholder. Call before creating a sandbox with them or mounting
 * them. A pool secret that can't be ensured fails the turn: the shared key
 * must never fall back to the sandbox. A user's own secret that can't is
 * left out, so the agent gets the value itself, as it did before secrets.
 */
export async function ensureTurnSecrets(daytona: Daytona, secrets: TurnSecret[]): Promise<ReadyTurnSecret[]> {
  const ready: ReadyTurnSecret[] = []
  for (const secret of secrets) {
    // A pool secret's failure is never swallowed: the shared key must never
    // fall back to the sandbox raw.
    if (secret.kind === "pool" && secret.poolSecretName) {
      const placeholder = await ensureSharedPoolSecret(daytona, secret.poolSecretName)
      ready.push({ ...secret, name: secret.poolSecretName, placeholder })
      continue
    }
    try {
      const name = secretName(secret.value, secret.hosts ?? [])
      const placeholder = await ensureSecret(daytona, () => secret.value, secret.hosts)
      ready.push({ ...secret, name, placeholder })
    } catch (err) {
      console.error(`[turn-secrets] passing ${secret.envKeys.join(", ") || secret.mountEnv} unprotected; its secret failed:`, err)
    }
  }
  return ready
}

function mountsOf(secrets: ReadyTurnSecret[]): Record<string, string> {
  return Object.fromEntries(secrets.map((s) => [s.mountEnv, s.name]))
}

/**
 * The secrets to mount at sandbox creation time, so a new sandbox never
 * needs the restart a later first mount would force.
 */
export function turnSecretsCreateParams(secrets: ReadyTurnSecret[]): Record<string, string> {
  return mountsOf(secrets)
}

/**
 * Mount exactly `secrets` on `sandbox` for the turn about to start (a no-op
 * when they already are), detaching whatever else was mounted for a
 * previous turn. Call as early in the send as possible.
 */
export async function mountTurnSecrets(daytona: Daytona, sandbox: DaytonaSandbox, secrets: ReadyTurnSecret[]): Promise<void> {
  await setSecrets(daytona, sandbox, mountsOf(secrets))
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
      if (env[key]?.includes(secret.value)) env[key] = env[key].split(secret.value).join(secret.placeholder)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (parseSecretMarker(value)) delete env[key]
  }
}

/**
 * The placeholder to hand `userId`'s Claude run for `run`'s token (shared or
 * their own), mounting its secret on the run's sandbox alongside the rest of
 * the turn's `knownSecrets` (env var → Daytona secret name — the caller's own
 * record of what else is mounted, since nothing is read back from the
 * sandbox any more). Undefined when the run should get the token itself:
 * the feature is off or the secret failed. Never throws.
 */
export async function mountClaudeSecret(
  daytona: Daytona,
  sandboxId: string,
  _userId: string,
  run: ClaudeRunToken,
  knownSecrets: Record<string, string> = {}
): Promise<string | undefined> {
  const enabled = run.source === "shared" ? subscriptionSecretsEnabled("CLAUDE_SHARED") : subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")
  if (!enabled) return undefined
  try {
    const name = secretName(run.token, CLAUDE_SECRET_HOSTS)
    const placeholder = await ensureSecret(daytona, () => run.token, CLAUDE_SECRET_HOSTS)
    const sandbox = await daytona.get(sandboxId)
    await setSecrets(daytona, sandbox, { ...knownSecrets, [CLAUDE_SHARED_MOUNT_ENV]: name })
    return placeholder
  } catch (err) {
    console.error(`[turn-secrets] passing the ${run.source} Claude token unprotected; its secret failed:`, err)
    return undefined
  }
}

/** The pool secret among `secrets` — the key id to attribute the turn's usage to. */
export function poolSecretOf(secrets: TurnSecret[]): string | undefined {
  return secrets.find((s) => s.kind === "pool")?.poolSecretName
}

/**
 * Detach every turn secret when a turn ends, so the placeholders left in the
 * sandbox stop working until the next turn mounts them again. Call it
 * BEFORE the chat is released back to "ready": sends are refused while the
 * chat is running, so the next turn's mount can never race this detach.
 * Never throws.
 */
export async function releaseTurnSecrets(daytona: Daytona, sandbox: DaytonaSandbox): Promise<void> {
  try {
    await setSecrets(daytona, sandbox, {})
  } catch (err) {
    console.error(`[turn-secrets] failed to detach secrets from sandbox ${sandbox.id}:`, err)
  }
}
