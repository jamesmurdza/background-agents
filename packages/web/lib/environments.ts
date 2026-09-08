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

/**
 * POSIX environment variable name rule. These keys reach a live shell (the
 * `export KEY=value` line that starts a sandbox job): the value is shell-
 * quoted there, but the key is interpolated raw, so a key outside this
 * pattern is not just malformed, it is a metacharacter injection into that
 * export line.
 */
const ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidEnvVarKey(key: string): boolean {
  return ENV_VAR_KEY_PATTERN.test(key)
}

/**
 * The first key (as the caller wrote it, untrimmed) that fails the POSIX
 * naming rule once trimmed, or null if every key is either valid or blank.
 * Blank keys are not reported here: they're a normal transient state while
 * editing (see envVarsToRecord) and are silently dropped by
 * encryptEnvironmentVariables, not rejected.
 */
export function findInvalidEnvVarKey(variables: Record<string, string>): string | null {
  for (const key of Object.keys(variables)) {
    const trimmed = key.trim()
    if (!trimmed) continue
    if (!isValidEnvVarKey(trimmed)) return key
  }
  return null
}

export function encryptEnvironmentVariables(plain: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(plain)) {
    const trimmed = key.trim()
    if (trimmed && isValidEnvVarKey(trimmed) && typeof value === "string") out[trimmed] = encrypt(value)
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
 * The wire shape the /environments UI (Task 7) and its API client consume.
 * Plain serializable data only: no Date, no Decimal, no Prisma JsonValue, so
 * this stays safe for client components to import with `import type`.
 */
export interface EnvironmentDTO {
  id: string
  repo: string
  name: string
  isDefault: boolean
  networkMode: NetworkMode
  allowedDomains: string[]
  /**
   * Decrypted. Only present when the caller asked for it (see
   * toEnvironmentDTO's includeVariables option): absent, not an empty
   * object, when it wasn't requested, so "no variables" and "not fetched"
   * stay distinguishable in the type.
   */
  variables?: Record<string, string>
  /** How many variables this environment has, independent of whether
   *  `variables` itself was included. Safe to show without decrypting. */
  variableCount: number
  hasSetupScript: boolean
  setupScript: string | null
  /** The version setupScript replaced, for the "agent updated the script"
   *  notice's diff view. Null when there's nothing to revert to (never
   *  edited, or already reverted). */
  setupScriptPrevious: string | null
  setupScriptUpdatedBy: "user" | "agent" | null
  updatedAt: number
}

type EnvironmentDTORow = EnvironmentRow & {
  setupScriptPrevious: string | null
  setupScriptUpdatedBy: string | null
  updatedAt: Date
}

function countEnvironmentVariables(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0
  return Object.keys(raw as Record<string, unknown>).length
}

/**
 * `includeVariables` defaults to true so existing single-environment callers
 * (GET/PATCH /api/environments/[id], POST /api/environments) keep returning
 * full variables without change. The list endpoint (GET /api/environments)
 * is the one caller that passes includeVariables: false by default, since
 * every environment on a repo doesn't need its secrets decrypted just to
 * render names in a picker or a list.
 */
export function toEnvironmentDTO(
  row: EnvironmentDTORow,
  options: { includeVariables?: boolean } = {}
): EnvironmentDTO {
  const includeVariables = options.includeVariables ?? true
  return {
    id: row.id,
    repo: row.repo,
    name: row.name,
    isDefault: row.isDefault,
    networkMode: toNetworkMode(row.networkMode),
    allowedDomains: row.allowedDomains,
    ...(includeVariables && { variables: decryptEnvironmentVariables(row.environmentVariables) }),
    variableCount: countEnvironmentVariables(row.environmentVariables),
    hasSetupScript: !!row.setupScript,
    setupScript: row.setupScript,
    setupScriptPrevious: row.setupScriptPrevious,
    setupScriptUpdatedBy:
      row.setupScriptUpdatedBy === "user" || row.setupScriptUpdatedBy === "agent"
        ? row.setupScriptUpdatedBy
        : null,
    updatedAt: row.updatedAt.getTime(),
  }
}

/**
 * An environment scoped to its owner. Returns null when it doesn't exist OR
 * belongs to a different user, so callers can return a single 404 without
 * distinguishing "not found" from "not yours" (that distinction is exactly
 * what would let another user's id be probed for existence).
 */
export async function getOwnedEnvironment(userId: string, id: string) {
  return prisma.environment.findFirst({ where: { id, userId } })
}

/**
 * `Environment` has two unique constraints that both surface as Prisma P2002:
 * `@@unique([userId, repo, name])` and the hand-written partial index
 * `Environment_one_default_per_repo` on `(userId, repo) WHERE isDefault`. A
 * bare "Unique constraint failed" message can't tell them apart, and they
 * mean very different things to a caller (a name collision they typed vs. a
 * concurrent request that changed the repo's default out from under them),
 * so this inspects which fields Prisma actually reports as violated.
 *
 * Confirmed against a real violation of each constraint via
 * `@prisma/adapter-pg` (Prisma 7.8.0, driver-adapter engine): the violated
 * field list lives at `error.meta.driverAdapterError.cause.constraint.fields`
 * (e.g. `["\"userId\"", "repo"]` for the partial index, `["\"userId\"",
 * "repo", "name"]` for the named-uniqueness one), NOT the classic
 * `error.meta.target` some Prisma engine versions report. That classic shape
 * is kept as a fallback in case a different adapter or a future engine
 * reports it that way instead.
 */
export function violatedEnvironmentUniqueFields(
  error: Prisma.PrismaClientKnownRequestError
): string[] {
  const meta = error.meta as Record<string, unknown> | undefined
  const driverAdapterError = meta?.driverAdapterError as { cause?: unknown } | undefined
  const cause = driverAdapterError?.cause as { constraint?: { fields?: unknown } } | undefined
  const adapterFields = cause?.constraint?.fields
  if (Array.isArray(adapterFields)) {
    return adapterFields.map((field) => String(field).replace(/"/g, ""))
  }

  const target = meta?.target
  if (Array.isArray(target)) return target.map(String)
  if (typeof target === "string") return target.split(",").map((s) => s.trim())
  return []
}

/** A user-facing message for a P2002 on the Environment model, above. */
export function environmentUniqueConstraintMessage(
  error: Prisma.PrismaClientKnownRequestError
): string {
  const fields = violatedEnvironmentUniqueFields(error)
  if (fields.includes("name")) {
    return "An environment with that name already exists for this repo"
  }
  if (fields.length > 0) {
    // No "name" among the violated fields means the partial default-per-repo
    // index was hit instead: another request created or promoted a default
    // for this repo at the same time.
    return "Another request just changed this repo's default environment. Refresh and try again."
  }
  // The violated fields couldn't be identified from the error metadata, so
  // either constraint could be the real cause; don't assert one over the
  // other.
  return "Either an environment with that name already exists for this repo, or another request just changed this repo's default environment. Refresh and try again."
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
    // this repo: promote that row to default.
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
