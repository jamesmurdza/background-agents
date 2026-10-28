/**
 * Unit tests for mounting shared pool keys as Daytona secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { DaytonaConflictError, type Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { toSecretMarker } from "@background-agents/sandbox-secrets"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import {
  SHARED_POOL_SECRET_LABEL,
  applyPoolSecretToEnv,
  ensureSharedPoolSecret,
  mountSharedPoolSecret,
  releaseSharedPoolSecrets,
  sharedPoolSecretCreateParams,
  sharedPoolSecretForRun,
  type MountedPoolSecret,
} from "./shared-pool-secrets"

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

const LABEL = SHARED_POOL_SECRET_LABEL
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

describe("mountSharedPoolSecret", () => {
  it("keeps an already-mounted configured secret without a remount", async () => {
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_2}` })
    const { daytona } = fakeDaytona([SECRET_2])
    await expect(mountSharedPoolSecret(asSandbox(sandbox), daytona, SECRET_1)).resolves.toEqual({
      pool: "opencode",
      name: SECRET_2,
      placeholder: placeholderFor(SECRET_2),
      readyAt: 0,
    })
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("mounts and restarts once a sandbox created without secrets", async () => {
    const sandbox = fakeSandbox({ repo: "o/r" })
    const mounted = await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)
    expect(mounted).toEqual({ pool: "opencode", name: SECRET_1, placeholder: placeholderFor(SECRET_1), readyAt: 0 })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).toHaveBeenCalledTimes(1)
    expect(sandbox.start).toHaveBeenCalledTimes(1)
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
  })

  it("remounts a detached sandbox without a restart, but waits for propagation", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    const before = Date.now()
    const mounted = await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)
    expect(mounted.name).toBe(SECRET_1)
    expect(mounted.readyAt).toBeGreaterThan(before)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[LABEL]).toBe(`SESSION_RELAY_TOKEN:${SECRET_1}`)
  })

  it("remounts a sandbox still labelled from the old OPENCODE_API_KEY mount", async () => {
    // Pre-rename label: a bare secret name, mounted under OPENCODE_API_KEY.
    const sandbox = fakeSandbox({ [LABEL]: SECRET_1 })
    const mounted = await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)
    expect(mounted.name).toBe(SECRET_1)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[LABEL]).toBe(`SESSION_RELAY_TOKEN:${SECRET_1}`)
  })

  it("remounts without a restart when the labelled secret is no longer configured", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "SESSION_RELAY_TOKEN:RETIRED_SECRET" })
    await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it("mounts a Gemini secret under its own env var, replacing another pool's leftover", async () => {
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    const mounted = await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, GEMINI_SECRET)
    expect(mounted).toMatchObject({ pool: "gemini", name: GEMINI_SECRET, placeholder: placeholderFor(GEMINI_SECRET) })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN_GEMINI: GEMINI_SECRET })
    expect(sandbox.labels[LABEL]).toBe(`SESSION_RELAY_TOKEN_GEMINI:${GEMINI_SECRET}`)
  })

  // The label is written last, and releaseSharedPoolSecrets keys off it, so
  // a mount that throws partway has to detach itself — otherwise it strands a
  // live placeholder nothing will ever clean up.
  it("detaches the secret again when the enabling restart fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))

    await expect(mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)).rejects.toThrow(
      "start timed out"
    )
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
    expect(sandbox.labels[LABEL]).toBeUndefined()
  })

  it("detaches the secret again when the label write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    sandbox.setLabels.mockRejectedValueOnce(new Error("labels rejected"))

    await expect(mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)).rejects.toThrow(
      "labels rejected"
    )
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
  })

  it("still surfaces the original failure when the rollback detach also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))
    sandbox.updateSecrets.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("gone"))

    await expect(mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_1)).rejects.toThrow(
      "start timed out"
    )
  })
})

describe("releaseSharedPoolSecrets", () => {
  it("detaches a mounted secret and marks the sandbox detached", async () => {
    const sandbox = fakeSandbox({ repo: "o/r", [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    await releaseSharedPoolSecrets(asSandbox(sandbox))
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: "none" })
  })

  it("makes no API call when nothing is mounted", async () => {
    for (const labels of [{}, { [LABEL]: "none" }] as Record<string, string>[]) {
      const sandbox = fakeSandbox(labels)
      await releaseSharedPoolSecrets(asSandbox(sandbox))
      expect(sandbox.updateSecrets).not.toHaveBeenCalled()
    }
  })

  it("never throws when the detach fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await expect(releaseSharedPoolSecrets(asSandbox(sandbox))).resolves.toBeUndefined()
  })

  // A "mounted" label with nothing mounted would make the next turn skip the
  // attach and run keyless, so the label must never get ahead of the detach.
  it("keeps the mounted label when the detach fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const mounted = { [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` }
    const sandbox = fakeSandbox(mounted)
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await releaseSharedPoolSecrets(asSandbox(sandbox))
    expect(sandbox.labels).toEqual(mounted)
  })

  it("leaves the secret mounted when the label write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.setLabels.mockRejectedValueOnce(new Error("boom"))
    await releaseSharedPoolSecrets(asSandbox(sandbox))
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("re-attaches on the next mount when the label was flipped but the detach failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    sandbox.setLabels
      .mockImplementationOnce(async (next: Record<string, string>) => (sandbox.labels = next))
      .mockRejectedValueOnce(new Error("restore failed"))
    await releaseSharedPoolSecrets(asSandbox(sandbox))
    expect(sandbox.labels[LABEL]).toBe("none")

    await mountSharedPoolSecret(asSandbox(sandbox), fakeDaytona().daytona, SECRET_2)
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ SESSION_RELAY_TOKEN: SECRET_2 })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })
})

describe("applyPoolSecretToEnv", () => {
  const mountedGemini: MountedPoolSecret = {
    pool: "gemini",
    name: GEMINI_SECRET,
    placeholder: placeholderFor(GEMINI_SECRET),
    readyAt: 0,
  }

  it("hands the agent the placeholder in place of the marker", () => {
    const env: Record<string, string> = { OPENCODE_API_KEY: toSecretMarker(SECRET_1), X: "1" }
    applyPoolSecretToEnv(env, { pool: "opencode", name: SECRET_2, placeholder: "dtn_secret_oc", readyAt: 0 })
    expect(env).toEqual({ OPENCODE_API_KEY: "dtn_secret_oc", X: "1" })
  })

  it("covers aliases of the same key", () => {
    const marker = toSecretMarker(GEMINI_SECRET)
    const env: Record<string, string> = { GEMINI_API_KEY: marker, GOOGLE_API_KEY: marker }
    applyPoolSecretToEnv(env, mountedGemini)
    expect(env).toEqual({ GEMINI_API_KEY: mountedGemini.placeholder, GOOGLE_API_KEY: mountedGemini.placeholder })
  })

  // Droid is handed every provider key it might use, whatever the model.
  it("drops markers of pools that aren't mounted", () => {
    const env: Record<string, string> = {
      GEMINI_API_KEY: toSecretMarker(GEMINI_SECRET),
      OPENCODE_API_KEY: toSecretMarker(SECRET_1),
      ANTHROPIC_API_KEY: "users-own-key",
    }
    applyPoolSecretToEnv(env, undefined)
    expect(env).toEqual({ ANTHROPIC_API_KEY: "users-own-key" })

    const other: Record<string, string> = { OPENCODE_API_KEY: toSecretMarker(SECRET_1) }
    applyPoolSecretToEnv(other, mountedGemini)
    expect(other).toEqual({})
  })

  it("leaves a value the user set untouched", () => {
    const own = { OPENCODE_API_KEY: "users-own-key" }
    applyPoolSecretToEnv(own, undefined)
    expect(own).toEqual({ OPENCODE_API_KEY: "users-own-key" })
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

describe("sharedPoolSecretCreateParams", () => {
  it("mounts the secret as its pool's env var and labels the sandbox with it", () => {
    expect(sharedPoolSecretCreateParams(SECRET_1)).toEqual({
      secrets: { SESSION_RELAY_TOKEN: SECRET_1 },
      labels: { [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` },
    })
    expect(sharedPoolSecretCreateParams(GEMINI_SECRET)).toEqual({
      secrets: { SESSION_RELAY_TOKEN_GEMINI: GEMINI_SECRET },
      labels: { [LABEL]: `SESSION_RELAY_TOKEN_GEMINI:${GEMINI_SECRET}` },
    })
  })
})
