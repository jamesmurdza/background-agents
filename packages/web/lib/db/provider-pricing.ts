import "server-only"

import { prisma } from "./prisma"
import { DEFAULT_MULTIPLIER, normalizeMultiplier } from "@/lib/server/credits"

/**
 * Per-provider pricing multiplier: the admin-editable knob behind
 * `ProviderPricing`, replacing the old hardcoded `DISCOUNT_DIVISOR` constant.
 *
 * A turn's chargeable cost is `listUsd * multiplier` (see `chargeableUsd` in
 * lib/server/credits), not `listUsd / divisor`. A multiplier of exactly 0
 * makes a provider free: `chargeTurnToCredits` (lib/db/credits) then charges
 * nothing for it, and `checkSharedPoolUsage` (lib/db/usage-limit) never blocks
 * a send on balance for it either — see `isFreeMultiplier`.
 *
 * Cached in-process because this is read on the hot path — every metered turn
 * and every send-gate check — and a Postgres round trip per message is not
 * worth paying just so an admin's edit is visible instantly in every other
 * request. `setProviderMultiplier` clears the cache on write, so the admin's
 * own next action (and this process's next read) always sees the new value;
 * other processes catch up within {@link CACHE_TTL_MS}.
 */

const CACHE_TTL_MS = 15_000

let cache: { byProvider: Record<string, number>; expiresAt: number } | null = null

async function loadMultipliers(): Promise<Record<string, number>> {
  const rows = await prisma.providerPricing.findMany()
  const byProvider: Record<string, number> = {}
  for (const row of rows) byProvider[row.provider] = row.multiplier
  return byProvider
}

/**
 * Every configured multiplier, keyed by provider. A provider with no row is
 * simply absent — callers should read it through {@link normalizeMultiplier}
 * (or call {@link getMultiplierFor}) rather than indexing directly, so a
 * missing key and a corrupt value both fall back to {@link DEFAULT_MULTIPLIER}
 * the same way.
 */
export async function getProviderMultipliers(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.byProvider
  const byProvider = await loadMultipliers()
  cache = { byProvider, expiresAt: now + CACHE_TTL_MS }
  return byProvider
}

/** One provider's multiplier — {@link DEFAULT_MULTIPLIER} if unset or invalid. */
export async function getMultiplierFor(provider: string): Promise<number> {
  const all = await getProviderMultipliers()
  return normalizeMultiplier(all[provider])
}

/** Ceiling on a multiplier, guarding against a fat-fingered admin edit. */
const MAX_MULTIPLIER = 100

/**
 * Set (or reset) a provider's multiplier and invalidate the cache.
 *
 * Validated here rather than trusted from the caller: this is the only write
 * path (the admin route calls nothing else), so a bad value stopped here can
 * never reach `ProviderPricing` at all. 0 is explicitly allowed — that is how
 * a provider is made free — but negative, non-finite, or absurdly large values
 * are rejected outright rather than silently clamped, since a clamp would let
 * a mistyped admin request land on some other number than the one requested.
 */
export async function setProviderMultiplier(
  provider: string,
  multiplier: number,
  updatedBy: string
): Promise<void> {
  if (!provider.trim()) throw new Error("provider is required")
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error("multiplier must be a finite number >= 0")
  }
  if (multiplier > MAX_MULTIPLIER) {
    throw new Error(`multiplier must be <= ${MAX_MULTIPLIER}`)
  }
  await prisma.providerPricing.upsert({
    where: { provider },
    create: { provider, multiplier, updatedBy },
    update: { multiplier, updatedBy },
  })
  cache = null
}

/** One provider's stored pricing row, as the admin panel renders it. */
export interface ProviderPricingRow {
  provider: string
  multiplier: number
  updatedAt: Date
  updatedBy: string | null
}

/** Every row as stored, for the admin panel. Providers with no row are omitted. */
export async function listProviderPricing(): Promise<ProviderPricingRow[]> {
  return prisma.providerPricing.findMany({ orderBy: { provider: "asc" } })
}

/** Test-only: force the next read to hit the database instead of the cache. */
export function _resetProviderPricingCache(): void {
  cache = null
}
