import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

import { deleteSecrets, ensureSecret, forgetSecrets } from "../src/index"

const placeholderFor = (name: string) => `dtn_secret_${name}`

function fakeDaytona(existing: string[] = []) {
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: existing.filter((n) => n.includes(name)).map((n) => ({ name: n, placeholder: placeholderFor(n) })),
    })),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
  }
  return { secret, daytona: { secret } as unknown as Daytona }
}

// ensureSecret memoizes per process, so every test uses its own names.
let counter = 0
const uniqueName = () => `secret_${Date.now()}_${counter++}`

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ensureSecret", () => {
  it("creates a missing secret with its value, hosts and description, and returns its placeholder", async () => {
    const { secret, daytona } = fakeDaytona()
    const name = uniqueName()
    const ensured = await ensureSecret(daytona, { name, value: () => "v1", hosts: ["example.com"], description: "d" })
    expect(secret.create).toHaveBeenCalledWith({ name, value: "v1", hosts: ["example.com"], description: "d" })
    expect(ensured).toEqual({ name, placeholder: placeholderFor(name) })
  })

  it("never recreates an existing secret, and checks once per process", async () => {
    const name = uniqueName()
    const { secret, daytona } = fakeDaytona([name])
    expect(await ensureSecret(daytona, { name, value: () => "v" })).toEqual({ name, placeholder: placeholderFor(name) })
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.list).toHaveBeenCalledTimes(1)
    expect(secret.create).not.toHaveBeenCalled()
  })

  it("treats a partial name match as missing", async () => {
    const name = uniqueName()
    const { secret, daytona } = fakeDaytona([`${name}_longer`])
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.create).toHaveBeenCalled()
  })

  it("accepts losing a create race to another process, and returns the winner's placeholder", async () => {
    const { secret, daytona } = fakeDaytona()
    const name = uniqueName()
    secret.create.mockRejectedValueOnce(new DaytonaConflictError("exists"))
    secret.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ name, placeholder: "dtn_secret_winner" }] })
    expect(await ensureSecret(daytona, { name, value: () => "v" })).toEqual({ name, placeholder: "dtn_secret_winner" })
  })

  it("forgets a failure so the next call retries", async () => {
    const { secret, daytona } = fakeDaytona()
    const name = uniqueName()
    secret.list.mockRejectedValueOnce(new Error("403 Access denied"))
    await expect(ensureSecret(daytona, { name, value: () => "v" })).rejects.toThrow("403")
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.create).toHaveBeenCalledTimes(1)
  })

  it("checks again after forgetSecrets", async () => {
    const name = uniqueName()
    const { secret, daytona } = fakeDaytona([name])
    await ensureSecret(daytona, { name, value: () => "v" })
    forgetSecrets([name])
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.list).toHaveBeenCalledTimes(2)
  })

  it("calls the value resolver first, so it can refuse an unknown name", async () => {
    const { secret, daytona } = fakeDaytona()
    const value = () => {
      throw new Error("unknown secret")
    }
    await expect(ensureSecret(daytona, { name: uniqueName(), value })).rejects.toThrow("unknown secret")
    expect(secret.list).not.toHaveBeenCalled()
  })
})

describe("deleteSecrets", () => {
  function listing(pages: { name: string; createdAt?: string }[][]) {
    const secret = {
      list: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
    }
    pages.forEach((items, i) =>
      secret.list.mockResolvedValueOnce({
        items: items.map((s) => ({ ...s, id: `id_${s.name}`, placeholder: placeholderFor(s.name) })),
        nextCursor: i < pages.length - 1 ? `c${i + 1}` : null,
      })
    )
    return { secret, daytona: { secret } as unknown as Daytona }
  }

  it("deletes every page's prefixed secrets except those kept", async () => {
    const { secret, daytona } = listing([
      [{ name: "u_a_old1" }, { name: "x_u_a_other" }],
      [{ name: "u_a_keep" }, { name: "u_a_old2" }],
    ])
    expect(await deleteSecrets(daytona, { prefix: "u_a_", keep: ["u_a_keep"] })).toEqual(["u_a_old1", "u_a_old2"])
    expect(secret.list).toHaveBeenNthCalledWith(2, { name: "u_a_", cursor: "c1", limit: 200 })
    expect(secret.delete.mock.calls).toEqual([["id_u_a_old1"], ["id_u_a_old2"]])
  })

  it("keeps the newest few when asked, for values that rotate", async () => {
    const { secret, daytona } = listing([
      [
        { name: "c_1", createdAt: "2026-10-01T00:00:00Z" },
        { name: "c_3", createdAt: "2026-10-03T00:00:00Z" },
        { name: "c_2", createdAt: "2026-10-02T00:00:00Z" },
        { name: "c_0", createdAt: "2026-09-30T00:00:00Z" },
      ],
    ])
    expect(await deleteSecrets(daytona, { prefix: "c_", keepNewest: 2 })).toEqual(["c_1", "c_0"])
    expect(secret.delete.mock.calls).toEqual([["id_c_1"], ["id_c_0"]])
  })

  it("makes a deleted secret be checked for again", async () => {
    const name = uniqueName()
    const { secret, daytona } = listing([[{ name }], [{ name }]])
    await ensureSecret(daytona, { name, value: () => "v" }) // found: memoized, not created
    await deleteSecrets(daytona, { prefix: name })
    secret.list.mockResolvedValueOnce({ items: [] })
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.create).toHaveBeenCalledTimes(1)
  })
})
