import "server-only"

import { prisma } from "./prisma"
import {
  INTERACTIVE_HARD_TIMEOUT,
  SCHEDULED_HARD_TIMEOUT,
} from "@/app/api/cron/agent-lifecycle/_lib/constants"

/**
 * Admin-editable ceiling on how long an agent run (interactive chat or
 * scheduled job) is allowed to keep going before the agent-lifecycle cron
 * force-stops it. Backed by a singleton `AgentRunLimits` row (id fixed at 1);
 * a missing row falls back to the hardcoded defaults from
 * app/api/cron/agent-lifecycle/_lib/constants, so this only needs writing
 * once an admin actually changes a value.
 *
 * Cached in-process for the same reason as lib/db/provider-pricing: the cron
 * reads this every tick, and a Postgres round trip per tick isn't worth
 * paying for a value that changes rarely. `setAgentRunLimits` clears the
 * cache on write, so the admin's own next save (and this process's next
 * read) sees the new value immediately; other processes catch up within
 * {@link CACHE_TTL_MS}.
 */

const SETTINGS_ID = 1
const CACHE_TTL_MS = 15_000

export interface AgentRunLimits {
  interactiveMinutes: number
  scheduledMinutes: number
}

const DEFAULTS: AgentRunLimits = {
  interactiveMinutes: INTERACTIVE_HARD_TIMEOUT,
  scheduledMinutes: SCHEDULED_HARD_TIMEOUT,
}

/** Sanity bounds guarding against a fat-fingered admin edit. */
const MIN_MINUTES = 1
const MAX_MINUTES = 24 * 60 // one day

let cache: { limits: AgentRunLimits; expiresAt: number } | null = null

async function loadLimits(): Promise<AgentRunLimits> {
  const row = await prisma.agentRunLimits.findUnique({ where: { id: SETTINGS_ID } })
  if (!row) return DEFAULTS
  return { interactiveMinutes: row.interactiveMinutes, scheduledMinutes: row.scheduledMinutes }
}

/** The current run-duration limits, in minutes — {@link DEFAULTS} if unset. */
export async function getAgentRunLimits(): Promise<AgentRunLimits> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.limits
  const limits = await loadLimits()
  cache = { limits, expiresAt: now + CACHE_TTL_MS }
  return limits
}

/** As stored, including audit fields, for the admin panel. */
export interface AgentRunLimitsRow extends AgentRunLimits {
  updatedAt: Date | null
  updatedBy: string | null
}

/** The limits as stored (or the defaults, unmarked) for the admin panel. */
export async function getAgentRunLimitsRow(): Promise<AgentRunLimitsRow> {
  const row = await prisma.agentRunLimits.findUnique({ where: { id: SETTINGS_ID } })
  if (!row) return { ...DEFAULTS, updatedAt: null, updatedBy: null }
  return row
}

function assertValidMinutes(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number of minutes`)
  }
  if (value < MIN_MINUTES || value > MAX_MINUTES) {
    throw new Error(`${label} must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes`)
  }
}

/**
 * Set both run-duration limits and invalidate the cache.
 *
 * Validated here rather than trusted from the caller: this is the only write
 * path (the admin route calls nothing else), so a bad value stopped here can
 * never reach `AgentRunLimits` at all. Both limits are written together as a
 * single row so a partial update never leaves the other half defaulted.
 */
export async function setAgentRunLimits(
  limits: AgentRunLimits,
  updatedBy: string
): Promise<void> {
  assertValidMinutes(limits.interactiveMinutes, "Interactive chat timeout")
  assertValidMinutes(limits.scheduledMinutes, "Scheduled job timeout")

  await prisma.agentRunLimits.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...limits, updatedBy },
    update: { ...limits, updatedBy },
  })
  cache = null
}

/** Test-only: force the next read to hit the database instead of the cache. */
export function _resetAgentRunLimitsCache(): void {
  cache = null
}
