/**
 * Environment resolution.
 *
 * Every read of an Environment goes through here. `Chat.environmentId` is
 * nullable (legacy chats predate the model; NEW_REPOSITORY chats have no repo),
 * so callers that touched the column directly would each need their own null
 * branch. resolveEnvironmentForChat collapses that into one place: a chat
 * without an explicit environment resolves to its repo's default, creating an
 * empty default if the repo has never had one.
 */

import { Prisma } from "@prisma/client"
import { BASELINE_DOMAINS } from "@background-agents/common"
import { prisma } from "@/lib/db/prisma"
import { encrypt, decrypt } from "@/lib/db/encryption"
import { NEW_REPOSITORY } from "@/lib/types"

export const NETWORK_MODES = ["full", "restricted"] as const
export type NetworkMode = (typeof NETWORK_MODES)[number]

export const DEFAULT_ENVIRONMENT_NAME = "Default"

/** An environment with its variables decrypted. Never persisted in this shape. */
export interface ResolvedEnvironment {
  id: string
  name: string
  repo: string
  isDefault: boolean
  networkMode: NetworkMode
  allowedDomains: string[]
  /** Decrypted. Empty object when the environment has none. */
  variables: Record<string, string>
  setupScript: string | null
}

/** Narrow an arbitrary stored string to a NetworkMode, defaulting to "full". */
function toNetworkMode(value: string): NetworkMode {
  return (NETWORK_MODES as readonly string[]).includes(value) ? (value as NetworkMode) : "full"
}

export function decryptEnvironmentVariables(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value) out[key] = decrypt(value)
  }
  return out
}

export function encryptEnvironmentVariables(plain: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(plain)) {
    const trimmed = key.trim()
    if (trimmed && typeof value === "string") out[trimmed] = encrypt(value)
  }
  return out
}

/**
 * The `domainAllowList` string for daytona.create, or undefined in full mode
 * (Daytona applies no restriction when the field is absent).
 */
export function resolveDomainAllowList(env: ResolvedEnvironment): string | undefined {
  if (env.networkMode !== "restricted") return undefined
  return Array.from(new Set([...BASELINE_DOMAINS, ...env.allowedDomains])).join(",")
}

type EnvironmentRow = {
  id: string
  name: string
  repo: string
  isDefault: boolean
  networkMode: string
  allowedDomains: string[]
  environmentVariables: unknown
  setupScript: string | null
}

export function toResolvedEnvironment(row: EnvironmentRow): ResolvedEnvironment {
  return {
    id: row.id,
    name: row.name,
    repo: row.repo,
    isDefault: row.isDefault,
    networkMode: toNetworkMode(row.networkMode),
    allowedDomains: row.allowedDomains,
    variables: decryptEnvironmentVariables(row.environmentVariables),
    setupScript: row.setupScript,
  }
}

/**
 * The repo's default environment, created empty if it doesn't exist yet.
 *
 * The create races with itself when two requests hit a repo that has never had
 * an environment; the partial unique index makes the loser fail, so we catch
 * and re-read rather than serializing every caller behind a lock.
 */
export async function getOrCreateDefaultEnvironment(
  userId: string,
  repo: string
): Promise<ResolvedEnvironment> {
  const existing = await prisma.environment.findFirst({
    where: { userId, repo, isDefault: true },
  })
  if (existing) return toResolvedEnvironment(existing)

  try {
    const created = await prisma.environment.create({
      data: { userId, repo, name: DEFAULT_ENVIRONMENT_NAME, isDefault: true },
    })
    return toResolvedEnvironment(created)
  } catch (error) {
    // Only a unique-constraint violation means "lost a race"; anything else
    // (connection failure, validation error, ...) is a real error and must
    // propagate with its original stack intact.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error
    }

    // Lost the race on the partial default index. Whoever won has created it;
    // read theirs.
    const winner = await prisma.environment.findFirst({
      where: { userId, repo, isDefault: true },
    })
    if (winner) return toResolvedEnvironment(winner)

    // No row is marked default, so the collision was instead on the
    // (userId, repo, name) unique constraint: a row named "Default" already
    // exists for this repo but was never promoted. This shouldn't happen
    // through the app today, but self-heal rather than throwing forever for
    // this repo — promote that row to default.
    const collided = await prisma.environment.findFirst({
      where: { userId, repo, name: DEFAULT_ENVIRONMENT_NAME },
    })
    if (collided) {
      // Two ordered statements in a transaction: Postgres checks the partial
      // unique index per statement, not deferred, so clearing any existing
      // default and setting this row's default cannot be a single updateMany.
      await prisma.$transaction([
        prisma.environment.updateMany({
          where: { userId, repo, isDefault: true },
          data: { isDefault: false },
        }),
        prisma.environment.update({
          where: { id: collided.id },
          data: { isDefault: true },
        }),
      ])
      return toResolvedEnvironment({ ...collided, isDefault: true })
    }

    throw new Error(`Failed to create default environment for ${repo}`, { cause: error })
  }
}

/**
 * The environment a chat's sandbox should be built from.
 *
 * Returns null only for NEW_REPOSITORY chats, which have no repo to scope an
 * environment to. Everything else resolves: the pinned environment when the
 * chat has one and it still exists, otherwise the repo's default.
 */
export async function resolveEnvironmentForChat(chat: {
  userId: string
  repo: string
  environmentId: string | null
}): Promise<ResolvedEnvironment | null> {
  if (chat.repo === NEW_REPOSITORY) return null

  if (chat.environmentId) {
    const pinned = await prisma.environment.findFirst({
      where: { id: chat.environmentId, userId: chat.userId },
    })
    // A deleted environment leaves environmentId null via SetNull, but a chat
    // read mid-delete can still carry a stale id. Fall through to the default.
    if (pinned) return toResolvedEnvironment(pinned)
  }

  return getOrCreateDefaultEnvironment(chat.userId, chat.repo)
}
