import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Daytona, Sandbox } from "@daytonaio/sdk"

import { createSandbox, setSecrets } from "../src/index"

function fakeDaytona(existingSecretNames: string[] = []) {
  const known = new Set(existingSecretNames)
  const secret = {
    list: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      items: [...known].filter((n) => n.includes(name)).map((n) => ({ id: `id_${n}`, name: n, placeholder: `ph_${n}` })),
    })),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      known.add(name)
      return { name, placeholder: `ph_${name}` }
    }),
    update: vi.fn().mockResolvedValue({}),
  }
  const create = vi.fn()
  return { secret, create, daytona: { secret, create } as unknown as Daytona }
}

function fakeSandbox(proxyWired = true) {
  const sandbox = {
    id: "sb1",
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    process: {
      executeCommand: vi.fn().mockResolvedValue({ result: proxyWired ? "http://proxy:1234" : "" }),
    },
  }
  return sandbox as unknown as Sandbox & typeof sandbox
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("setSecrets", () => {
  it("mounts the given set plus a keepalive, and stamps every one as used", async () => {
    const { daytona } = fakeDaytona(["bg_abc"])
    const sandbox = fakeSandbox()
    await setSecrets(daytona, sandbox, { MY_KEY: "bg_abc" })
    const mounted = sandbox.updateSecrets.mock.calls[0][0] as Record<string, string>
    expect(mounted.MY_KEY).toBe("bg_abc")
    expect(Object.keys(mounted)).toContain("SESSION_RELAY_TOKEN_KEEPALIVE")
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it("detaches everything but the keepalive when given an empty set", async () => {
    const { daytona } = fakeDaytona()
    const sandbox = fakeSandbox()
    await setSecrets(daytona, sandbox, {})
    const mounted = sandbox.updateSecrets.mock.calls[0][0] as Record<string, string>
    expect(Object.keys(mounted)).toEqual(["SESSION_RELAY_TOKEN_KEEPALIVE"])
  })

  it("restarts the sandbox when the secrets proxy comes back unwired", async () => {
    const { daytona } = fakeDaytona(["bg_abc"])
    const sandbox = fakeSandbox(false)
    await setSecrets(daytona, sandbox, { MY_KEY: "bg_abc" })
    expect(sandbox.stop).toHaveBeenCalled()
    expect(sandbox.start).toHaveBeenCalled()
  })

  it("never restarts when there's nothing to attach, even with the proxy unwired", async () => {
    const { daytona } = fakeDaytona()
    const sandbox = fakeSandbox(false)
    await setSecrets(daytona, sandbox, {})
    expect(sandbox.process.executeCommand).not.toHaveBeenCalled()
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it("doesn't restart when the proxy is already wired", async () => {
    const { daytona } = fakeDaytona(["bg_abc"])
    const sandbox = fakeSandbox(true)
    await setSecrets(daytona, sandbox, { MY_KEY: "bg_abc" })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })
})

describe("createSandbox", () => {
  it("creates the sandbox with its secrets and the keepalive attached, so it never restarts", async () => {
    const { daytona, create } = fakeDaytona(["bg_abc"])
    const sandbox = fakeSandbox()
    create.mockResolvedValue(sandbox)
    const result = await createSandbox(daytona, { name: "s" }, { MY_KEY: "bg_abc" })
    const { name, secrets } = create.mock.calls[0][0]
    expect(name).toBe("s")
    expect(Object.keys(secrets)).toEqual(["MY_KEY", "SESSION_RELAY_TOKEN_KEEPALIVE"])
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(result).toBe(sandbox)
  })

  it("defaults to no secrets beyond the keepalive", async () => {
    const { daytona, create } = fakeDaytona()
    create.mockResolvedValue(fakeSandbox())
    await createSandbox(daytona, { name: "s" })
    expect(Object.keys(create.mock.calls[0][0].secrets)).toEqual(["SESSION_RELAY_TOKEN_KEEPALIVE"])
  })
})
