/**
 * Unit tests for mounting the shared OpenCode key as a Daytona secret.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { secretNameForKey, toSecretMarker } from "./opencode-pool"
import {
  OPENCODE_SECRET_LABEL,
  ensureSharedOpencodeSecret,
  mountSharedOpencodeSecret,
  opencodeSecretCreateParams,
  releaseSharedOpencodeSecret,
  sharedOpencodeSecretForRun,
  applySecretToAgentEnv,
} from "./opencode-secrets"

function fakeSandbox(labels: Record<string, string> = {}) {
  const sandbox = {
    id: "sb-1",
    labels: { ...labels },
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    setLabels: vi.fn().mockImplementation(async (next: Record<string, string>) => {
      sandbox.labels = next
      return next
    }),
  }
  return sandbox
}

const asSandbox = (sandbox: ReturnType<typeof fakeSandbox>) => sandbox as unknown as DaytonaSandbox

const SECRET_1 = secretNameForKey("key-1")
const SECRET_2 = secretNameForKey("key-2")

beforeEach(() => {
  process.env.OPENCODE_API_KEY = "key-1,key-2"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.OPENCODE_API_KEY
  vi.restoreAllMocks()
})

function fakeDaytona(existing: string[] = []) {
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: existing.filter((n) => n.includes(name)).map((n) => ({ name: n })),
    })),
    create: vi.fn().mockResolvedValue({}),
  }
  return { secret, daytona: { secret } as unknown as Daytona }
}

describe("ensureSharedOpencodeSecret", () => {
  it("creates a missing secret from its key, allowlisted to opencode.ai", async () => {
    const { secret, daytona } = fakeDaytona()
    await ensureSharedOpencodeSecret(daytona, SECRET_1)
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: SECRET_1, value: "key-1", hosts: ["opencode.ai"] })
    )
  })

  it("never recreates an existing secret, and checks once per process", async () => {
    const { secret, daytona } = fakeDaytona([SECRET_2])
    await ensureSharedOpencodeSecret(daytona, SECRET_2)
    await ensureSharedOpencodeSecret(daytona, SECRET_2)
    expect(secret.create).not.toHaveBeenCalled()
    expect(secret.list).toHaveBeenCalledTimes(1)
  })

  it("treats a concurrent create as success", async () => {
    process.env.OPENCODE_API_KEY = "key-3"
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new DaytonaConflictError("exists", 409))
    await expect(ensureSharedOpencodeSecret(daytona, secretNameForKey("key-3"))).resolves.toBeUndefined()
  })

  it("rejects, and retries next time, when the secret can't be created", async () => {
    process.env.OPENCODE_API_KEY = "key-4"
    const name = secretNameForKey("key-4")
    const { secret, daytona } = fakeDaytona()
    secret.create.mockRejectedValueOnce(new Error("forbidden"))
    await expect(ensureSharedOpencodeSecret(daytona, name)).rejects.toThrow("forbidden")
    await expect(ensureSharedOpencodeSecret(daytona, name)).resolves.toBeUndefined()
    expect(secret.create).toHaveBeenCalledTimes(2)
  })

  it("rejects a secret no configured key maps to", async () => {
    const { daytona } = fakeDaytona()
    await expect(ensureSharedOpencodeSecret(daytona, "opencode_unknown")).rejects.toThrow()
  })
})

describe("mountSharedOpencodeSecret", () => {
  it("keeps an already-mounted configured secret without API calls", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: `SESSION_RELAY_TOKEN:${SECRET_2}` })
    await expect(mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)).resolves.toEqual({
      name: SECRET_2,
      readyAt: 0,
    })
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("mounts and restarts once a sandbox created without secrets", async () => {
    const sandbox = fakeSandbox({ repo: "o/r" })
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)
    expect(mounted).toEqual({ name: SECRET_1, readyAt: 0 })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).toHaveBeenCalledTimes(1)
    expect(sandbox.start).toHaveBeenCalledTimes(1)
    expect(sandbox.labels).toEqual({ repo: "o/r", [OPENCODE_SECRET_LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
  })

  it("remounts a detached sandbox without a restart, but waits for propagation", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "none" })
    const before = Date.now()
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)
    expect(mounted.name).toBe(SECRET_1)
    expect(mounted.readyAt).toBeGreaterThan(before)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[OPENCODE_SECRET_LABEL]).toBe(`SESSION_RELAY_TOKEN:${SECRET_1}`)
  })

  it("remounts a sandbox still labelled from the old OPENCODE_API_KEY mount", async () => {
    // Pre-rename label: a bare secret name, mounted under OPENCODE_API_KEY.
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: SECRET_1 })
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)
    expect(mounted.name).toBe(SECRET_1)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[OPENCODE_SECRET_LABEL]).toBe(`SESSION_RELAY_TOKEN:${SECRET_1}`)
  })

  it("remounts without a restart when the labelled secret is no longer configured", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:RETIRED_SECRET" })
    await mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  // The label is written last, and releaseSharedOpencodeSecret keys off it, so
  // a mount that throws partway has to detach itself — otherwise it strands a
  // live placeholder nothing will ever clean up.
  it("detaches the secret again when the enabling restart fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))

    await expect(mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)).rejects.toThrow(
      "start timed out"
    )
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
    expect(sandbox.labels[OPENCODE_SECRET_LABEL]).toBeUndefined()
  })

  it("detaches the secret again when the label write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "none" })
    sandbox.setLabels.mockRejectedValueOnce(new Error("labels rejected"))

    await expect(mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)).rejects.toThrow(
      "labels rejected"
    )
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
  })

  it("still surfaces the original failure when the rollback detach also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))
    sandbox.updateSecrets.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("gone"))

    await expect(mountSharedOpencodeSecret(asSandbox(sandbox), SECRET_1)).rejects.toThrow(
      "start timed out"
    )
  })
})

describe("releaseSharedOpencodeSecret", () => {
  it("detaches a mounted secret and marks the sandbox detached", async () => {
    const sandbox = fakeSandbox({ repo: "o/r", [OPENCODE_SECRET_LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    await releaseSharedOpencodeSecret(asSandbox(sandbox))
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
    expect(sandbox.labels).toEqual({ repo: "o/r", [OPENCODE_SECRET_LABEL]: "none" })
  })

  it("makes no API call when nothing is mounted", async () => {
    for (const labels of [{}, { [OPENCODE_SECRET_LABEL]: "none" }] as Record<string, string>[]) {
      const sandbox = fakeSandbox(labels)
      await releaseSharedOpencodeSecret(asSandbox(sandbox))
      expect(sandbox.updateSecrets).not.toHaveBeenCalled()
    }
  })

  it("never throws when the detach fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await expect(releaseSharedOpencodeSecret(asSandbox(sandbox))).resolves.toBeUndefined()
  })
})

describe("applySecretToAgentEnv", () => {
  it("swaps the marker for an agent-only config pointing OpenCode Go at the mounted var", () => {
    const env: Record<string, string> = { OPENCODE_API_KEY: toSecretMarker(SECRET_1), X: "1" }
    applySecretToAgentEnv(env)
    expect(env).not.toHaveProperty("OPENCODE_API_KEY")
    expect(env.X).toBe("1")
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual({
      provider: { "opencode-go": { options: { apiKey: "{env:SESSION_RELAY_TOKEN}" } } },
    })
  })

  it("leaves a value the user set untouched", () => {
    const own = { OPENCODE_API_KEY: "users-own-key" }
    applySecretToAgentEnv(own)
    expect(own).toEqual({ OPENCODE_API_KEY: "users-own-key" })
  })
})

describe("sharedOpencodeSecretForRun", () => {
  const marker = { OPENCODE_API_KEY: toSecretMarker(SECRET_1) }

  it("returns the secret for a paid opencode-go model", () => {
    expect(sharedOpencodeSecretForRun(marker, "opencode", "opencode-go/mimo-v2.5-pro")).toBe(SECRET_1)
  })

  it("returns undefined for a free model or a raw key", () => {
    expect(sharedOpencodeSecretForRun(marker, "opencode", "opencode/big-pickle")).toBeUndefined()
    expect(
      sharedOpencodeSecretForRun({ OPENCODE_API_KEY: "raw" }, "opencode", "opencode-go/mimo-v2.5-pro")
    ).toBeUndefined()
  })
})

describe("opencodeSecretCreateParams", () => {
  it("mounts the secret as SESSION_RELAY_TOKEN and labels the sandbox with it", () => {
    expect(opencodeSecretCreateParams(SECRET_1)).toEqual({
      secrets: { SESSION_RELAY_TOKEN: SECRET_1 },
      labels: { [OPENCODE_SECRET_LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` },
    })
  })
})
