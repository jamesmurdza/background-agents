/**
 * Deleting Daytona secrets nothing uses any more (server-only), for the
 * secret-cleanup cron.
 *
 * Saves and refreshes already delete what they replace (syncUserKeySecret,
 * syncEndpointSecrets, syncEnvVarSecrets, the prune* helpers), but only
 * best effort, and some things never get that chance: a deleted user, a key
 * removed from a shared pool, a feature switched off. This sweep finds them
 * by name:
 *
 * - shared pool secrets (`opencode_`, `gemini_`) for keys no longer
 *   configured; a pool with no keys configured here is left alone, as that
 *   more likely means a different deployment than removed keys;
 * - shared Claude token secrets but the newest two;
 * - a user's secrets (`u_<tag>_`) when the user is gone, or when nothing in
 *   their current keys, endpoints or env vars would create that name (their
 *   Codex token secrets: all but the newest two);
 * - the shared OpenCode secrets once made by hand in the Daytona dashboard.
 *
 * Every other secret in the org is ignored, and so is anything created in
 * the last {@link GRACE_MS}: a secret is created before the setting that
 * needs it is saved, and must not be swept in between.
 */

import type { Daytona } from "@daytonaio/sdk"
import { forgetSecrets, parseSecretMarker } from "@background-agents/sandbox-secrets"

import { getUserCredentials } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { getUserEndpoints } from "@/lib/server/custom-endpoints"
import { endpointSecretSpecs, endpointSecretsEnabled } from "@/lib/server/endpoint-secrets"
import {
  chatEnvScope,
  decodeEnvVars,
  envVarSecretSpec,
  envVarSecretsEnabled,
  envVarSecretsOf,
  repoEnvScope,
} from "@/lib/server/env-var-secrets"
import { getSharedKeys, getSharedSecretNames, sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import {
  CLAUDE_SHARED_SECRET_PREFIX,
  KEEP_NEWEST,
  codexSecretPrefix,
  subscriptionSecretsEnabled,
} from "@/lib/server/subscription-secrets"
import {
  USER_KEY_PROVIDERS,
  userKeySecretName,
  userKeySecretsEnabled,
  userSecretTag,
} from "@/lib/server/user-key-secrets"

/** Secrets younger than this are never deleted. */
export const GRACE_MS = 60 * 60 * 1000

/** Shared OpenCode secrets created by hand before they were derived from the keys. */
export const LEGACY_SECRET_NAMES = ["OPENCODE_API_KEY_1", "OPENCODE_API_KEY_2"]

const USER_SECRET = /^u_([0-9a-f]{10})_/

export interface ListedSecret {
  id: string
  name: string
  /** Epoch ms. */
  createdAt: number
}

/** What a user's secrets should be. */
export interface UserSecretState {
  /** Names their current keys, endpoints and env vars would create. */
  expected: Set<string>
  /** Prefix of their Codex token secrets, when those are in use (newest kept). */
  codexPrefix?: string
}

export interface CleanupPlan {
  /** Unused, and old enough to delete. */
  doomed: ListedSecret[]
  /** Unused, but within {@link GRACE_MS}. */
  young: number
  /** Not ours to judge. */
  ignored: number
}

function newest(secrets: ListedSecret[], count: number): Set<string> {
  return new Set([...secrets].sort((a, b) => b.createdAt - a.createdAt).slice(0, count).map((s) => s.name))
}

/**
 * Decide which of `secrets` to delete. Pure. `users` maps the tag in a
 * user secret's name to that user's state, "unknown" when it couldn't be
 * loaded (their secrets are then left alone); a tag missing from it belongs
 * to no user.
 */
export function planSecretCleanup(
  secrets: ListedSecret[],
  users: Map<string, UserSecretState | "unknown">,
  now: number
): CleanupPlan {
  const plan: CleanupPlan = { doomed: [], young: 0, ignored: 0 }
  const keepClaude = subscriptionSecretsEnabled("CLAUDE_SHARED")
    ? newest(secrets.filter((s) => s.name.startsWith(CLAUDE_SHARED_SECRET_PREFIX)), KEEP_NEWEST)
    : new Set<string>()
  const keepCodex = new Set<string>()
  for (const state of users.values()) {
    if (state === "unknown" || !state.codexPrefix) continue
    const prefix = state.codexPrefix
    for (const name of newest(secrets.filter((s) => s.name.startsWith(prefix)), KEEP_NEWEST)) keepCodex.add(name)
  }

  for (const secret of secrets) {
    const { name } = secret
    let unused: boolean | undefined
    const pool = sharedPoolForSecret(name)
    const userTag = USER_SECRET.exec(name)?.[1]
    if (LEGACY_SECRET_NAMES.includes(name)) {
      unused = true
    } else if (pool) {
      if (getSharedKeys(pool).length > 0) unused = !getSharedSecretNames(pool).includes(name)
    } else if (name.startsWith(CLAUDE_SHARED_SECRET_PREFIX)) {
      unused = !keepClaude.has(name)
    } else if (userTag) {
      const state = users.get(userTag)
      if (!state) unused = true
      else if (state !== "unknown") unused = !state.expected.has(name) && !keepCodex.has(name)
    }

    if (unused === undefined) plan.ignored++
    else if (!unused) continue
    else if (now - secret.createdAt < GRACE_MS) plan.young++
    else plan.doomed.push(secret)
  }
  return plan
}

/** The secret names `userId`'s current settings would create. */
export async function loadUserSecretState(userId: string): Promise<UserSecretState> {
  const [credentials, endpoints, user, chats] = await Promise.all([
    getUserCredentials(userId),
    getUserEndpoints(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { repoEnvironmentVariables: true } }),
    prisma.chat.findMany({ where: { userId }, select: { id: true, environmentVariables: true } }),
  ])
  const expected = new Set<string>()

  for (const credential of Object.keys(USER_KEY_PROVIDERS)) {
    const value = credentials[credential as keyof typeof credentials]
    if (value && userKeySecretsEnabled(credential) && !parseSecretMarker(value)) {
      expected.add(userKeySecretName(userId, credential, value))
    }
  }
  if (endpointSecretsEnabled()) {
    for (const spec of endpointSecretSpecs(userId, endpoints)) expected.add(spec.name)
  }
  if (envVarSecretsEnabled()) {
    const scopes = [
      ...chats.map((chat) => [chatEnvScope(chat.id), chat.environmentVariables] as const),
      ...Object.entries((user?.repoEnvironmentVariables as Record<string, unknown> | null) ?? {}).map(
        ([repo, stored]) => [repoEnvScope(repo), stored] as const
      ),
    ]
    for (const [scope, stored] of scopes) {
      for (const secret of envVarSecretsOf(decodeEnvVars(stored), scope)) {
        expected.add(envVarSecretSpec(userId, secret).name)
      }
    }
  }
  const usesCodex = !!credentials.CODEX_CREDENTIALS && subscriptionSecretsEnabled("CODEX_CREDENTIALS")
  return { expected, codexPrefix: usesCodex ? codexSecretPrefix(userId) : undefined }
}

async function listAllSecrets(daytona: Daytona): Promise<ListedSecret[]> {
  const secrets: ListedSecret[] = []
  let cursor: string | undefined
  do {
    const page = await daytona.secret.list({ cursor, limit: 200 })
    for (const s of page.items) secrets.push({ id: s.id, name: s.name, createdAt: new Date(s.createdAt).getTime() })
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return secrets
}

export interface CleanupReport {
  dryRun: boolean
  scanned: number
  /** Deleted, or with `dryRun`, would be. Names hold hashes only. */
  deleted: string[]
  young: number
  ignored: number
  errors: number
}

/** Sweep the org's secrets; with `dryRun`, only report what would go. */
export async function cleanupSecrets(daytona: Daytona, { dryRun }: { dryRun: boolean }): Promise<CleanupReport> {
  const secrets = await listAllSecrets(daytona)

  const tags = new Set(secrets.flatMap((s) => USER_SECRET.exec(s.name)?.[1] ?? []))
  const users = new Map<string, UserSecretState | "unknown">()
  if (tags.size > 0) {
    for (const { id } of await prisma.user.findMany({ select: { id: true } })) {
      const tag = userSecretTag(id)
      if (!tags.has(tag)) continue
      try {
        users.set(tag, await loadUserSecretState(id))
      } catch (err) {
        console.error("[secret-cleanup] couldn't load a user's settings; leaving their secrets:", err)
        users.set(tag, "unknown")
      }
    }
  }

  const plan = planSecretCleanup(secrets, users, Date.now())
  const report: CleanupReport = {
    dryRun,
    scanned: secrets.length,
    deleted: [],
    young: plan.young,
    ignored: plan.ignored,
    errors: 0,
  }
  for (const secret of plan.doomed) {
    if (dryRun) {
      report.deleted.push(secret.name)
      continue
    }
    try {
      await daytona.secret.delete(secret.id)
      forgetSecrets([secret.name])
      report.deleted.push(secret.name)
    } catch (err) {
      console.error(`[secret-cleanup] failed to delete ${secret.name}:`, err)
      report.errors++
    }
  }
  return report
}
