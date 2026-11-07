/**
 * Deleting Daytona secrets nothing uses any more (server-only), for the
 * secret-cleanup cron.
 *
 * Any of our secrets unused for {@link UNUSED_MS} goes, whatever it is:
 * every use stamps it (ensureSecret, at most every few hours), and whatever
 * still needs it recreates it on next use. Use is judged from that stamp, so
 * this holds across every deployment sharing the Daytona org.
 *
 * Sooner than that, saves and refreshes already delete what they replace
 * (syncUserKeySecret, the prune* helpers), but only best effort, and some
 * things never get that chance: a deleted user, a key removed from a shared
 * pool, a feature switched off. This sweep also finds those by name:
 *
 * - shared pool secrets (`opencode_`, `gemini_`) for keys no longer
 *   configured; a pool with no keys configured here is left alone, as that
 *   more likely means a different deployment than removed keys;
 * - shared Claude token secrets but the newest two;
 * - a user's secrets (`u_<tag>_`) when the user is gone, or when nothing in
 *   their current keys would create that name (their Codex and own Claude
 *   token secrets: all but the newest two);
 * - the shared OpenCode secrets once made by hand in the Daytona dashboard.
 *
 * Nothing mounted on a sandbox is ever deleted (a running turn, a stopped
 * sandbox keeping its pinned ones), nor a secret by name within
 * {@link GRACE_MS} of its creation: a secret is created
 * before the setting that needs it is saved, and must not be swept in
 * between. Secrets this app didn't create are ignored.
 */

import type { Daytona } from "@daytonaio/sdk"
import {
  decodeMounts,
  forgetSecrets,
  parseSecretMarker,
  secretLastUsedAt,
} from "@background-agents/sandbox-secrets"

import { getUserCredentials } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { getSharedKeys, getSharedSecretNames, isSharedKey, sharedPoolForSecret } from "@/lib/server/shared-key-pools"
import {
  CLAUDE_SHARED_SECRET_PREFIX,
  KEEP_NEWEST,
  claudeOwnSecretPrefix,
  codexSecretPrefix,
  subscriptionSecretsEnabled,
} from "@/lib/server/subscription-secrets"
import { PINNED_SECRETS_LABEL, TURN_SECRETS_LABEL } from "@/lib/server/turn-secrets"
import {
  USER_KEY_PROVIDERS,
  userKeySecretName,
  userKeySecretsEnabled,
  userSecretTag,
} from "@/lib/server/user-key-secrets"

/** Secrets younger than this are never deleted for being unneeded by name. */
export const GRACE_MS = 60 * 60 * 1000

/**
 * Secrets unused for this long are deleted. Comfortably above REVERIFY_MS,
 * how often a process using one stamps it.
 */
export const UNUSED_MS = 24 * 60 * 60 * 1000

/** Shared OpenCode secrets created by hand before they were derived from the keys. */
export const LEGACY_SECRET_NAMES = ["OPENCODE_API_KEY_1", "OPENCODE_API_KEY_2"]

const USER_SECRET = /^u_([0-9a-f]{10})_/

export interface ListedSecret {
  id: string
  name: string
  /** Epoch ms. */
  createdAt: number
  /** Epoch ms; see secretLastUsedAt. */
  lastUsedAt: number
}

/** What a user's secrets should be. */
export interface UserSecretState {
  /** Names their current keys would create. */
  expected: Set<string>
  /**
   * Prefixes of their subscription token secrets in use (Codex, their own
   * Claude): of each, the newest are kept.
   */
  tokenPrefixes: string[]
}

export interface CleanupPlan {
  /** To delete. */
  doomed: ListedSecret[]
  /** Unneeded by name, but within {@link GRACE_MS}. */
  young: number
  /** Kept because a sandbox has it mounted. */
  mounted: number
  /** Not created by this app. */
  ignored: number
}

function newest(secrets: ListedSecret[], count: number): Set<string> {
  return new Set([...secrets].sort((a, b) => b.createdAt - a.createdAt).slice(0, count).map((s) => s.name))
}

/** Whether this app created `name` (see the prefixes in this module's doc). */
function isOurs(name: string): boolean {
  return (
    LEGACY_SECRET_NAMES.includes(name) ||
    !!sharedPoolForSecret(name) ||
    name.startsWith(CLAUDE_SHARED_SECRET_PREFIX) ||
    USER_SECRET.test(name)
  )
}

/**
 * Decide which of `secrets` to delete. Pure. `users` maps the tag in a
 * user secret's name to that user's state, "unknown" when it couldn't be
 * loaded (their secrets are then judged by use only); a tag missing from it
 * belongs to no user. `mounted` names the secrets some sandbox has mounted.
 */
export function planSecretCleanup(
  secrets: ListedSecret[],
  users: Map<string, UserSecretState | "unknown">,
  now: number,
  mounted: Set<string> = new Set()
): CleanupPlan {
  const plan: CleanupPlan = { doomed: [], young: 0, mounted: 0, ignored: 0 }
  const keepClaude = subscriptionSecretsEnabled("CLAUDE_SHARED")
    ? newest(secrets.filter((s) => s.name.startsWith(CLAUDE_SHARED_SECRET_PREFIX)), KEEP_NEWEST)
    : new Set<string>()
  const keepTokens = new Set<string>()
  for (const state of users.values()) {
    if (state === "unknown") continue
    for (const prefix of state.tokenPrefixes) {
      for (const name of newest(secrets.filter((s) => s.name.startsWith(prefix)), KEEP_NEWEST)) keepTokens.add(name)
    }
  }

  for (const secret of secrets) {
    const { name } = secret
    if (!isOurs(name)) {
      plan.ignored++
      continue
    }
    if (mounted.has(name)) {
      plan.mounted++
      continue
    }
    if (now - secret.lastUsedAt >= UNUSED_MS) {
      plan.doomed.push(secret)
      continue
    }

    // Unneeded by name? Undefined when that can't be judged here.
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
      else if (state !== "unknown") unused = !state.expected.has(name) && !keepTokens.has(name)
    }

    if (!unused) continue
    if (now - secret.createdAt < GRACE_MS) plan.young++
    else plan.doomed.push(secret)
  }
  return plan
}

/** The secret names `userId`'s current settings would create. */
export async function loadUserSecretState(userId: string): Promise<UserSecretState> {
  const credentials = await getUserCredentials(userId)
  const expected = new Set<string>()

  for (const credential of Object.keys(USER_KEY_PROVIDERS)) {
    const value = credentials[credential as keyof typeof credentials]
    if (value && userKeySecretsEnabled(credential) && !parseSecretMarker(value) && !isSharedKey(credential, value)) {
      expected.add(userKeySecretName(userId, credential, value))
    }
  }
  const tokenPrefixes: string[] = []
  if (credentials.CODEX_CREDENTIALS && subscriptionSecretsEnabled("CODEX_CREDENTIALS")) {
    tokenPrefixes.push(codexSecretPrefix(userId))
  }
  if (credentials.CLAUDE_CODE_CREDENTIALS && subscriptionSecretsEnabled("CLAUDE_CODE_CREDENTIALS")) {
    tokenPrefixes.push(claudeOwnSecretPrefix(userId))
  }
  return { expected, tokenPrefixes }
}

async function listAllSecrets(daytona: Daytona): Promise<ListedSecret[]> {
  const secrets: ListedSecret[] = []
  let cursor: string | undefined
  do {
    const page = await daytona.secret.list({ cursor, limit: 200 })
    for (const s of page.items) {
      secrets.push({ id: s.id, name: s.name, createdAt: new Date(s.createdAt).getTime(), lastUsedAt: secretLastUsedAt(s) })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return secrets
}

/**
 * Every secret some sandbox in the org has mounted, from the labels that
 * record them (lib/server/turn-secrets). A label from before mount sets is a
 * bare secret name.
 */
async function listMountedSecrets(daytona: Daytona): Promise<Set<string>> {
  const mounted = new Set<string>()
  for await (const sandbox of daytona.list({ limit: 200 })) {
    for (const label of [TURN_SECRETS_LABEL, PINNED_SECRETS_LABEL]) {
      const value = sandbox.labels?.[label]
      if (!value) continue
      const mounts = decodeMounts(value)
      for (const name of mounts ? Object.values(mounts) : [value]) mounted.add(name)
    }
  }
  return mounted
}

export interface CleanupReport {
  dryRun: boolean
  scanned: number
  /** Deleted, or with `dryRun`, would be. Names hold hashes only. */
  deleted: string[]
  young: number
  mounted: number
  ignored: number
  errors: number
}

/** Sweep the org's secrets; with `dryRun`, only report what would go. */
export async function cleanupSecrets(daytona: Daytona, { dryRun }: { dryRun: boolean }): Promise<CleanupReport> {
  const [secrets, mounted] = await Promise.all([listAllSecrets(daytona), listMountedSecrets(daytona)])

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

  const plan = planSecretCleanup(secrets, users, Date.now(), mounted)
  const report: CleanupReport = {
    dryRun,
    scanned: secrets.length,
    deleted: [],
    young: plan.young,
    mounted: plan.mounted,
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
