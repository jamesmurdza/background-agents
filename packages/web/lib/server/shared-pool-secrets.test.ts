/**
 * Unit tests for choosing and creating shared pool secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

import { toSecretMarker } from "@background-agents/sandbox-secrets"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import { ensureSharedPoolSecret, sharedPoolSecretForRun } from "./shared-pool-secrets"

const SECRET_1 = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-1")
const SECRET_2 = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-2")
const GEMINI_SECRET = secretNameForKey(SHARED_KEY_POOLS.gemini, "gemini-key")
const placeholderFor = (name: string) => `dtn_secret_${name}`

beforeEach(() => {
  process.env.OPENCODE_API_KEY = "key-1,key-2"
  process.env.GEMINI_API_KEY = "gemini-key"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.OPENCODE_API_KEY
  delete process.env.GEMINI_API_KEY
  vi.restoreAllMocks()
})

function fakeDaytona(existing: string[] = []) {
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: existing.filter((n) => n.includes(name)).map((n) => ({ name: n, placeholder: placeholderFor(n) })),
    })),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
  }
  return { secret, daytona: { secret } as unknown as Daytona }
}

describe("ensureSharedPoolSecret", () => {
  it("creates a missing secret from its key, allowlisted to opencode.ai", async () => {
    const { secret, daytona } = fakeDaytona()
    await expect(ensureSharedPoolSecret(daytona, SECRET_1)).resolves.toEqual({
      name: SECRET_1,
      placeholder: placeholderFor(SECRET_1),
    })
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: SECRET_1, value: "key-1", hosts: ["opencode.ai"] })
    )
  })

  it("creates a Gemini secret allowlisted to the Gemini API", async () => {
    const { secret, daytona } = fakeDaytona()
    await ensureSharedPoolSecret(daytona, GEMINI_SECRET)
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GEMINI_SECRET,
        value: "gemini-key",
        hosts: ["generativelanguage.googleapis.com"],
      })
    )
  })

  it("never recreates an existing secret, and checks once per process", async () => {
    const { secret, daytona } = fakeDaytona([SECRET_2])
    await ensureSharedPoolSecret(daytona, SECRET_2)
    await ensureSharedPoolSecret(daytona, SECRET_2)
    expect(secret.create).not.toHaveBeenCalled()
    expect(secret.list).toHaveBeenCalledTimes(1)
  })

  it("treats a concurrent create as success", async () => {
    process.env.OPENCODE_API_KEY = "key-3"
    const name = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-3")
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new DaytonaConflictError("exists", 409))
    secret.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ name, placeholder: placeholderFor(name) }] })
    await expect(ensureSharedPoolSecret(daytona, name)).resolves.toEqual({ name, placeholder: placeholderFor(name) })
  })

  it("rejects, and retries next time, when the secret can't be created", async () => {
    process.env.OPENCODE_API_KEY = "key-4"
    const name = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-4")
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new Error("forbidden"))
    await expect(ensureSharedPoolSecret(daytona, name)).rejects.toThrow("forbidden")
    await expect(ensureSharedPoolSecret(daytona, name)).resolves.toMatchObject({ name })
    expect(secret.create).toHaveBeenCalledTimes(2)
  })

  it("rejects a secret no configured key or pool maps to", async () => {
    const { daytona } = fakeDaytona()
    await expect(ensureSharedPoolSecret(daytona, "opencode_unknown")).rejects.toThrow()
    await expect(ensureSharedPoolSecret(daytona, "anthropic_123")).rejects.toThrow()
  })
})

describe("sharedPoolSecretForRun", () => {
  const markers = {
    OPENCODE_API_KEY: toSecretMarker(SECRET_1),
    GEMINI_API_KEY: toSecretMarker(GEMINI_SECRET),
  }

  it("returns the secret for a paid opencode-go model", () => {
    expect(sharedPoolSecretForRun(markers, "opencode", "opencode-go/mimo-v2.5-pro")).toBe(SECRET_1)
  })

  it("returns the Gemini secret for a Gemini model, on any agent", () => {
    expect(sharedPoolSecretForRun(markers, "gemini", "gemini-2.5-flash")).toBe(GEMINI_SECRET)
    expect(sharedPoolSecretForRun(markers, "droid", "gemini-2.5-flash")).toBe(GEMINI_SECRET)
  })

  it("returns undefined for a free model, a provider without a pool, or a raw key", () => {
    expect(sharedPoolSecretForRun(markers, "opencode", "opencode/big-pickle")).toBeUndefined()
    expect(sharedPoolSecretForRun(markers, "claude-code", "sonnet")).toBeUndefined()
    expect(
      sharedPoolSecretForRun({ OPENCODE_API_KEY: "raw" }, "opencode", "opencode-go/mimo-v2.5-pro")
    ).toBeUndefined()
  })
})
