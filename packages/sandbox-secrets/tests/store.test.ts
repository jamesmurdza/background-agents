import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

import { deleteStaleSecrets, ensureSecret, secretLastUsedAt, secretName, stampLastUsed } from "../src/index"

const placeholderFor = (name: string) => `dtn_secret_${name}`

function fakeDaytona(existing: string[] = []) {
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: existing.filter((n) => n.includes(name)).map((n) => ({ id: `id_${n}`, name: n, placeholder: placeholderFor(n) })),
    })),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  }
  return { secret, daytona: { secret } as unknown as Daytona }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ensureSecret", () => {
  it("creates a missing secret with its value, hosts and a used stamp, and returns its placeholder", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 28))
    const { secret, daytona } = fakeDaytona()
    const name = secretName("v1", ["example.com"])
    const placeholder = await ensureSecret(daytona, () => "v1", ["example.com"])
    expect(secret.create).toHaveBeenCalledWith({
      name,
      value: "v1",
      hosts: ["example.com"],
      description: "[used 2026-10-28T00:00:00.000Z]",
    })
    expect(placeholder).toBe(placeholderFor(name))
  })

  it("stamps an existing secret as used, never touching its value", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 28))
    const name = secretName("v")
    const { secret, daytona } = fakeDaytona([name])
    await ensureSecret(daytona, () => "v")
    expect(secret.update).toHaveBeenCalledWith(`id_${name}`, { description: "[used 2026-10-28T00:00:00.000Z]" })
    expect(secret.create).not.toHaveBeenCalled()
  })

  it("still returns the placeholder when the stamp fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const name = secretName("v")
    const { secret, daytona } = fakeDaytona([name])
    secret.update.mockRejectedValueOnce(new Error("500"))
    expect(await ensureSecret(daytona, () => "v")).toBe(placeholderFor(name))
  })

  it("treats a partial name match as missing", async () => {
    const name = secretName("v")
    const { secret, daytona } = fakeDaytona([`${name}_longer`])
    await ensureSecret(daytona, () => "v")
    expect(secret.create).toHaveBeenCalled()
  })

  it("names the same value with different hosts differently", async () => {
    const { daytona } = fakeDaytona()
    expect(secretName("v", ["a.com"])).not.toBe(secretName("v", ["b.com"]))
  })

  it("accepts losing a create race to another process, and returns the winner's placeholder", async () => {
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new DaytonaConflictError("exists"))
    const name = secretName("v")
    secret.list.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [{ name, placeholder: "dtn_secret_winner" }] })
    expect(await ensureSecret(daytona, () => "v")).toBe("dtn_secret_winner")
  })

  it("calls the value resolver first, so it can refuse an unknown name", async () => {
    const { secret } = fakeDaytona()
    const value = (): string => {
      throw new Error("unknown secret")
    }
    const daytona = { secret } as unknown as Daytona
    await expect(ensureSecret(daytona, value)).rejects.toThrow("unknown secret")
    expect(secret.list).not.toHaveBeenCalled()
  })

  it("re-checks on every call (no caching across calls)", async () => {
    const name = secretName("v")
    const { secret, daytona } = fakeDaytona([name])
    await ensureSecret(daytona, () => "v")
    await ensureSecret(daytona, () => "v")
    expect(secret.list).toHaveBeenCalledTimes(2)
    expect(secret.create).not.toHaveBeenCalled()
  })
})

describe("secretLastUsedAt", () => {
  it("reads the stamp, falling back to the creation time", () => {
    const createdAt = "2026-10-01T00:00:00.000Z"
    expect(secretLastUsedAt({ createdAt, description: stampLastUsed(Date.UTC(2026, 9, 28)) })).toBe(Date.UTC(2026, 9, 28))
    expect(secretLastUsedAt({ createdAt, description: "d" })).toBe(Date.UTC(2026, 9, 1))
    expect(secretLastUsedAt({ createdAt, description: "d [used garbage]" })).toBe(Date.UTC(2026, 9, 1))
    expect(secretLastUsedAt({ createdAt: new Date(createdAt) })).toBe(Date.UTC(2026, 9, 1))
  })
})

describe("deleteStaleSecrets", () => {
  function listing(pages: { name: string; createdAt?: string; description?: string }[][]) {
    const secret = {
      list: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    pages.forEach((items, i) =>
      secret.list.mockResolvedValueOnce({
        items: items.map((s) => ({ createdAt: "2026-10-01T00:00:00Z", ...s, id: `id_${s.name}` })),
        nextCursor: i < pages.length - 1 ? `c${i + 1}` : null,
      })
    )
    return { secret, daytona: { secret } as unknown as Daytona }
  }

  it("deletes only this app's secrets whose stamp is old enough", async () => {
    const now = Date.UTC(2026, 9, 28)
    vi.spyOn(Date, "now").mockReturnValue(now)
    const { secret, daytona } = listing([
      [
        { name: "bg_old", description: stampLastUsed(now - 25 * 60 * 60 * 1000) },
        { name: "bg_recent", description: stampLastUsed(now - 1000) },
        { name: "unrelated_bg_but_not_prefixed" },
      ],
    ])
    expect(await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)).toEqual(["bg_old"])
    expect(secret.delete.mock.calls).toEqual([["id_bg_old"]])
  })

  it("paginates through every page", async () => {
    const now = Date.UTC(2026, 9, 28)
    vi.spyOn(Date, "now").mockReturnValue(now)
    const { secret, daytona } = listing([
      [{ name: "bg_1", description: stampLastUsed(now - 48 * 60 * 60 * 1000) }],
      [{ name: "bg_2", description: stampLastUsed(now - 48 * 60 * 60 * 1000) }],
    ])
    expect(await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)).toEqual(["bg_1", "bg_2"])
    expect(secret.list).toHaveBeenNthCalledWith(2, { name: "bg_", cursor: "c1", limit: 200 })
  })

  it("logs and continues when a delete fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const now = Date.UTC(2026, 9, 28)
    vi.spyOn(Date, "now").mockReturnValue(now)
    const { secret, daytona } = listing([
      [
        { name: "bg_1", description: stampLastUsed(now - 48 * 60 * 60 * 1000) },
        { name: "bg_2", description: stampLastUsed(now - 48 * 60 * 60 * 1000) },
      ],
    ])
    secret.delete.mockRejectedValueOnce(new Error("boom"))
    expect(await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)).toEqual(["bg_2"])
  })
})
