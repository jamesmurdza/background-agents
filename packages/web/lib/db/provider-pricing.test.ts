/**
 * Tests for the cached read/write path behind the admin pricing panel.
 *
 * Mocks the Prisma client the same way lib/db/credits.test.ts does — this is
 * testing the caching and validation wrapped around `ProviderPricing`, not
 * Prisma itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted above imports, so the mocks it references must be too —
// see the same pattern in app/api/user/settings/route.test.ts.
const { findMany, upsert } = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { providerPricing: { findMany, upsert } },
}))

import {
  getMultiplierFor,
  getProviderMultipliers,
  setProviderMultiplier,
  _resetProviderPricingCache,
} from "./provider-pricing"

beforeEach(() => {
  findMany.mockReset()
  upsert.mockReset()
  _resetProviderPricingCache()
})

describe("getProviderMultipliers", () => {
  it("reads rows into a provider → multiplier map", async () => {
    findMany.mockResolvedValue([
      { provider: "claude", multiplier: 0.05 },
      { provider: "opencode", multiplier: 0.5 },
    ])
    expect(await getProviderMultipliers()).toEqual({ claude: 0.05, opencode: 0.5 })
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it("caches between calls instead of re-querying every turn", async () => {
    findMany.mockResolvedValue([{ provider: "claude", multiplier: 0.05 }])
    await getProviderMultipliers()
    await getProviderMultipliers()
    await getProviderMultipliers()
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})

describe("getMultiplierFor", () => {
  it("returns the configured multiplier for a known provider", async () => {
    findMany.mockResolvedValue([{ provider: "gemini", multiplier: 0.5 }])
    expect(await getMultiplierFor("gemini")).toBe(0.5)
  })

  it("falls back to the default for a provider with no row", async () => {
    // Pi, Droid, Kilo and Kimi are always own-key and never reach the charging
    // path — but an unconfigured id must never be cheaper by accident.
    findMany.mockResolvedValue([])
    expect(await getMultiplierFor("pi")).toBe(1)
  })
})

describe("setProviderMultiplier", () => {
  it("upserts the row and invalidates the cache", async () => {
    findMany.mockResolvedValue([{ provider: "claude", multiplier: 0.05 }])
    upsert.mockResolvedValue({})

    expect(await getMultiplierFor("claude")).toBe(0.05)
    expect(findMany).toHaveBeenCalledTimes(1)

    await setProviderMultiplier("claude", 0.1, "admin_1")
    expect(upsert).toHaveBeenCalledWith({
      where: { provider: "claude" },
      create: { provider: "claude", multiplier: 0.1, updatedBy: "admin_1" },
      update: { multiplier: 0.1, updatedBy: "admin_1" },
    })

    // The stale cache must not still answer the next read.
    findMany.mockResolvedValue([{ provider: "claude", multiplier: 0.1 }])
    expect(await getMultiplierFor("claude")).toBe(0.1)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it("allows 0 — that is how a provider is made free", async () => {
    upsert.mockResolvedValue({})
    await expect(setProviderMultiplier("opencode", 0, "admin_1")).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { multiplier: 0, updatedBy: "admin_1" } })
    )
  })

  it("rejects a negative, non-finite, or absurdly large multiplier", async () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1000]) {
      await expect(setProviderMultiplier("claude", bad, "admin_1")).rejects.toThrow()
    }
    expect(upsert).not.toHaveBeenCalled()
  })

  it("rejects an empty provider id", async () => {
    await expect(setProviderMultiplier("  ", 1, "admin_1")).rejects.toThrow()
    expect(upsert).not.toHaveBeenCalled()
  })
})
