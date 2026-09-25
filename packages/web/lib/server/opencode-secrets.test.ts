/**
 * Unit tests for mounting the shared OpenCode key as a Daytona secret.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { toSecretMarker } from "./opencode-pool"
import {
  OPENCODE_SECRET_LABEL,
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

beforeEach(() => {
  process.env.OPENCODE_DAYTONA_SECRETS = "OPENCODE_API_KEY_1,OPENCODE_API_KEY_2"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.OPENCODE_DAYTONA_SECRETS
  vi.restoreAllMocks()
})

describe("mountSharedOpencodeSecret", () => {
  it("keeps an already-mounted configured secret without API calls", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:OPENCODE_API_KEY_2" })
    await expect(mountSharedOpencodeSecret(asSandbox(sandbox), "OPENCODE_API_KEY_1")).resolves.toEqual({
      name: "OPENCODE_API_KEY_2",
      readyAt: 0,
    })
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("mounts and restarts once a sandbox created without secrets", async () => {
    const sandbox = fakeSandbox({ repo: "o/r" })
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), "OPENCODE_API_KEY_1")
    expect(mounted).toEqual({ name: "OPENCODE_API_KEY_1", readyAt: 0 })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: "OPENCODE_API_KEY_1" })
    expect(sandbox.stop).toHaveBeenCalledTimes(1)
    expect(sandbox.start).toHaveBeenCalledTimes(1)
    expect(sandbox.labels).toEqual({ repo: "o/r", [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1" })
  })

  it("remounts a detached sandbox without a restart, but waits for propagation", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "none" })
    const before = Date.now()
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), "OPENCODE_API_KEY_1")
    expect(mounted.name).toBe("OPENCODE_API_KEY_1")
    expect(mounted.readyAt).toBeGreaterThan(before)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: "OPENCODE_API_KEY_1" })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[OPENCODE_SECRET_LABEL]).toBe("SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1")
  })

  it("remounts a sandbox still labelled from the old OPENCODE_API_KEY mount", async () => {
    // Pre-rename label: a bare secret name, mounted under OPENCODE_API_KEY.
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "OPENCODE_API_KEY_1" })
    const mounted = await mountSharedOpencodeSecret(asSandbox(sandbox), "OPENCODE_API_KEY_1")
    expect(mounted.name).toBe("OPENCODE_API_KEY_1")
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: "OPENCODE_API_KEY_1" })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[OPENCODE_SECRET_LABEL]).toBe("SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1")
  })

  it("remounts without a restart when the labelled secret is no longer configured", async () => {
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:RETIRED_SECRET" })
    await mountSharedOpencodeSecret(asSandbox(sandbox), "OPENCODE_API_KEY_1")
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: "OPENCODE_API_KEY_1" })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })
})

describe("releaseSharedOpencodeSecret", () => {
  it("detaches a mounted secret and marks the sandbox detached", async () => {
    const sandbox = fakeSandbox({ repo: "o/r", [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1" })
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
    const sandbox = fakeSandbox({ [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1" })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await expect(releaseSharedOpencodeSecret(asSandbox(sandbox))).resolves.toBeUndefined()
  })
})

describe("applySecretToAgentEnv", () => {
  it("swaps the marker for an agent-only config pointing OpenCode Go at the mounted var", () => {
    const env: Record<string, string> = { OPENCODE_API_KEY: toSecretMarker("OPENCODE_API_KEY_1"), X: "1" }
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
  const marker = { OPENCODE_API_KEY: toSecretMarker("OPENCODE_API_KEY_1") }

  it("returns the secret for a paid opencode-go model", () => {
    expect(sharedOpencodeSecretForRun(marker, "opencode", "opencode-go/mimo-v2.5-pro")).toBe("OPENCODE_API_KEY_1")
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
    expect(opencodeSecretCreateParams("OPENCODE_API_KEY_1")).toEqual({
      secrets: { SESSION_RELAY_TOKEN: "OPENCODE_API_KEY_1" },
      labels: { [OPENCODE_SECRET_LABEL]: "SESSION_RELAY_TOKEN:OPENCODE_API_KEY_1" },
    })
  })
})
