import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

import { ensureSecret } from "../src/index"

function fakeDaytona(existing: string[] = []) {
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: existing.filter((n) => n.includes(name)).map((n) => ({ name: n })),
    })),
    create: vi.fn().mockResolvedValue({}),
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
  it("creates a missing secret with its value, hosts and description", async () => {
    const { secret, daytona } = fakeDaytona()
    const name = uniqueName()
    await ensureSecret(daytona, { name, value: () => "v1", hosts: ["example.com"], description: "d" })
    expect(secret.create).toHaveBeenCalledWith({ name, value: "v1", hosts: ["example.com"], description: "d" })
  })

  it("never recreates an existing secret, and checks once per process", async () => {
    const name = uniqueName()
    const { secret, daytona } = fakeDaytona([name])
    await ensureSecret(daytona, { name, value: () => "v" })
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

  it("accepts losing a create race to another process", async () => {
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new DaytonaConflictError("exists"))
    await expect(ensureSecret(daytona, { name: uniqueName(), value: () => "v" })).resolves.toBeUndefined()
  })

  it("forgets a failure so the next call retries", async () => {
    const { secret, daytona } = fakeDaytona()
    const name = uniqueName()
    secret.list.mockRejectedValueOnce(new Error("403 Access denied"))
    await expect(ensureSecret(daytona, { name, value: () => "v" })).rejects.toThrow("403")
    await ensureSecret(daytona, { name, value: () => "v" })
    expect(secret.create).toHaveBeenCalledTimes(1)
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
