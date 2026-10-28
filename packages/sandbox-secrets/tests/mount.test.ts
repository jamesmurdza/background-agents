import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Sandbox } from "@daytonaio/sdk"

import {
  decodeMounts,
  encodeMounts,
  mountSecrets,
  readMounts,
  readPinned,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
} from "../src/index"

const LABEL = "test-secrets"
const OPTIONS = { label: LABEL }
const PINNED = "test-pinned"
const PINNING = { label: LABEL, pinnedLabel: PINNED }

function fakeSandbox(labels: Record<string, string> = {}) {
  const sandbox = {
    id: "sb-1",
    labels: { ...labels },
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    // A sandbox that booted with the secrets proxy.
    process: { executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "http://172.20.0.1:18080" }) },
    setLabels: vi.fn().mockImplementation(async (next: Record<string, string>) => {
      sandbox.labels = next
      return next
    }),
  }
  return sandbox
}

const asSandbox = (sandbox: ReturnType<typeof fakeSandbox>) => sandbox as unknown as Sandbox

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("encodeMounts / decodeMounts", () => {
  it("round-trips sets of any size", () => {
    for (const mounts of [{}, { A: "s1" }, { A: "s1", B_KEY: "s-2", C: "s_3" }]) {
      expect(decodeMounts(encodeMounts(mounts))).toEqual(mounts)
    }
  })

  it("encodes the empty set as 'none' and a single mount as ENV:secret", () => {
    expect(encodeMounts({})).toBe("none")
    expect(encodeMounts({ SESSION_RELAY_TOKEN: "opencode_abc" })).toBe("SESSION_RELAY_TOKEN:opencode_abc")
  })

  it("treats a missing or unrecognised label as unknown", () => {
    for (const label of [undefined, "", "bare_secret_name", "A:s1:B", "A::B:s2"]) {
      expect(decodeMounts(label)).toBeUndefined()
    }
  })
})

describe("secretsCreateParams", () => {
  it("mounts the set at creation and records it in the label", () => {
    expect(secretsCreateParams({ A: "s1", B: "s2" }, OPTIONS)).toEqual({
      secrets: { A: "s1", B: "s2" },
      labels: { [LABEL]: "A:s1:B:s2" },
    })
  })

  it("mounts the pinned set too, and records it", () => {
    expect(secretsCreateParams({ A: "s1" }, PINNING, { P: "p1" })).toEqual({
      secrets: { P: "p1", A: "s1" },
      labels: { [LABEL]: "P:p1:A:s1", [PINNED]: "P:p1" },
    })
    expect(secretsCreateParams({}, PINNING)).toEqual({ secrets: {}, labels: { [LABEL]: "none", [PINNED]: "none" } })
  })
})

describe("readMounts", () => {
  it("reports whether secrets are enabled and what is mounted", () => {
    expect(readMounts(asSandbox(fakeSandbox()), OPTIONS)).toEqual({ enabled: false, mounts: undefined })
    expect(readMounts(asSandbox(fakeSandbox({ [LABEL]: "none" })), OPTIONS)).toEqual({ enabled: true, mounts: {} })
    expect(readMounts(asSandbox(fakeSandbox({ [LABEL]: "legacy" })), OPTIONS)).toEqual({ enabled: true, mounts: undefined })
  })
})

describe("readPinned", () => {
  it("reads the pinned set, empty when there is none or no pinned label", () => {
    expect(readPinned(asSandbox(fakeSandbox({ [PINNED]: "P:p1" })), PINNING)).toEqual({ P: "p1" })
    expect(readPinned(asSandbox(fakeSandbox({ [PINNED]: "garbled" })), PINNING)).toEqual({})
    expect(readPinned(asSandbox(fakeSandbox({ [PINNED]: "P:p1" })), OPTIONS)).toEqual({})
  })
})

describe("mountSecrets", () => {
  it("mounts the pinned set alongside the turn's and records both", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none", [PINNED]: "none" })
    const result = await mountSecrets(asSandbox(sandbox), { A: "s1" }, PINNING, { P: "p1" })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ P: "p1", A: "s1" })
    expect(result.mounts).toEqual({ P: "p1", A: "s1" })
    expect(sandbox.labels).toEqual({ [LABEL]: "P:p1:A:s1", [PINNED]: "P:p1" })
  })

  it("only rewrites the pinned label when the mounted set is unchanged", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "P:p1:A:s1", [PINNED]: "none" })
    const result = await mountSecrets(asSandbox(sandbox), { A: "s1" }, PINNING, { P: "p1" })
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
    expect(result.readyAt).toBe(0)
    expect(sandbox.labels[PINNED]).toBe("P:p1")
  })

  it("makes no API call when the label already records the set", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1:B:s2" })
    const result = await mountSecrets(asSandbox(sandbox), { B: "s2", A: "s1" }, OPTIONS)
    expect(result.readyAt).toBe(0)
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("replaces a different set without a restart, but waits for propagation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000)
    const sandbox = fakeSandbox({ repo: "o/r", [LABEL]: "A:s1" })
    const result = await mountSecrets(asSandbox(sandbox), { A: "s1", B: "s2" }, { ...OPTIONS, propagationMs: 500 })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ A: "s1", B: "s2" })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(result.readyAt).toBe(1500)
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: "A:s1:B:s2" })
  })

  it("remounts a detached sandbox without a restart", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ A: "s1" })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it("remounts a sandbox with an unrecognised label without a restart", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "legacy_name" })
    await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[LABEL]).toBe("A:s1")
  })

  it("restarts a detached sandbox that came back from a stop without its proxy", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    sandbox.process.executeCommand.mockResolvedValue({ exitCode: 1, result: "" })
    const result = await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.updateSecrets.mock.invocationCallOrder[0]).toBeLessThan(sandbox.stop.mock.invocationCallOrder[0])
    expect(sandbox.start).toHaveBeenCalled()
    expect(result.readyAt).toBe(0)
    expect(sandbox.labels[LABEL]).toBe("A:s1")
  })

  it("doesn't restart when the proxy can't be checked, or the set is unchanged", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    sandbox.process.executeCommand.mockRejectedValue(new Error("toolbox down"))
    await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.stop).not.toHaveBeenCalled()

    const unchanged = fakeSandbox({ [LABEL]: "A:s1" })
    await mountSecrets(asSandbox(unchanged), { A: "s1" }, OPTIONS)
    expect(unchanged.process.executeCommand).not.toHaveBeenCalled()
  })

  it("restarts a sandbox that has never had secrets, and needs no wait after", async () => {
    const sandbox = fakeSandbox()
    const result = await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.updateSecrets.mock.invocationCallOrder[0]).toBeLessThan(sandbox.stop.mock.invocationCallOrder[0])
    expect(sandbox.start).toHaveBeenCalled()
    expect(result.readyAt).toBe(0)
    expect(sandbox.labels[LABEL]).toBe("A:s1")
  })

  it("detaches again when the enabling restart fails", async () => {
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start failed"))
    await expect(mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)).rejects.toThrow("start failed")
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
    expect(sandbox.labels[LABEL]).toBeUndefined()
  })

  it("restores the previous set when the label write fails", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1" })
    sandbox.setLabels.mockRejectedValueOnce(new Error("label failed"))
    await expect(mountSecrets(asSandbox(sandbox), { B: "s2" }, OPTIONS)).rejects.toThrow("label failed")
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ A: "s1" })
  })

  it("still surfaces the original failure when the rollback also fails", async () => {
    const sandbox = fakeSandbox()
    sandbox.stop.mockRejectedValueOnce(new Error("stop failed"))
    sandbox.updateSecrets.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("rollback failed"))
    await expect(mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)).rejects.toThrow("stop failed")
  })
})

describe("waitForPropagation", () => {
  it("returns at once for a mount that is already live", async () => {
    const started = Date.now()
    await waitForPropagation({ readyAt: 0 })
    expect(Date.now() - started).toBeLessThan(50)
  })
})

describe("releaseSecrets", () => {
  it("keeps the pinned set by default", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "P:p1:A:s1", [PINNED]: "P:p1" })
    await releaseSecrets(asSandbox(sandbox), PINNING)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ P: "p1" })
    expect(sandbox.labels).toEqual({ [LABEL]: "P:p1", [PINNED]: "P:p1" })
  })

  it("records an explicit keep as the pinned set", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "P:p1", [PINNED]: "P:p1" })
    await releaseSecrets(asSandbox(sandbox), PINNING, {})
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
    expect(sandbox.labels).toEqual({ [LABEL]: "none", [PINNED]: "none" })
  })

  it("makes no API call between turns with only pinned secrets mounted, or none", async () => {
    // A sandbox from before pinning has no pinned label: nothing is pinned.
    for (const labels of [{ [LABEL]: "P:p1", [PINNED]: "P:p1" }, { [LABEL]: "none" }]) {
      const sandbox = fakeSandbox(labels)
      await releaseSecrets(asSandbox(sandbox), PINNING)
      expect(sandbox.updateSecrets).not.toHaveBeenCalled()
      expect(sandbox.setLabels).not.toHaveBeenCalled()
    }
  })

  it("detaches everything and marks the sandbox detached", async () => {
    const sandbox = fakeSandbox({ repo: "o/r", [LABEL]: "A:s1:B:s2" })
    await releaseSecrets(asSandbox(sandbox), OPTIONS)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: "none" })
  })

  it("shrinks the set to what should stay mounted", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1:B:s2" })
    await releaseSecrets(asSandbox(sandbox), OPTIONS, { B: "s2" })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ B: "s2" })
    expect(sandbox.labels[LABEL]).toBe("B:s2")
  })

  it("makes no API call when nothing would change", async () => {
    const cases: [Record<string, string>, Record<string, string>][] = [
      [{}, {}],
      [{ [LABEL]: "none" }, {}],
      [{ [LABEL]: "B:s2" }, { B: "s2" }],
    ]
    for (const [labels, keep] of cases) {
      const sandbox = fakeSandbox(labels)
      await releaseSecrets(asSandbox(sandbox), OPTIONS, keep)
      expect(sandbox.updateSecrets).not.toHaveBeenCalled()
      expect(sandbox.setLabels).not.toHaveBeenCalled()
    }
  })

  it("still detaches a sandbox with an unrecognised label", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "legacy_name" })
    await releaseSecrets(asSandbox(sandbox), OPTIONS)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
  })

  it("never throws, and keeps the mounted label when the detach fails", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1" })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await expect(releaseSecrets(asSandbox(sandbox), OPTIONS)).resolves.toBeUndefined()
    expect(sandbox.labels[LABEL]).toBe("A:s1")
  })

  it("leaves the secrets mounted when the label write fails", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1" })
    sandbox.setLabels.mockRejectedValueOnce(new Error("boom"))
    await releaseSecrets(asSandbox(sandbox), OPTIONS)
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("re-attaches on the next mount when the label was flipped but the detach failed", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "A:s1" })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    sandbox.setLabels
      .mockImplementationOnce(async (next: Record<string, string>) => (sandbox.labels = next))
      .mockRejectedValueOnce(new Error("restore failed"))
    await releaseSecrets(asSandbox(sandbox), OPTIONS)
    expect(sandbox.labels[LABEL]).toBe("none")

    await mountSecrets(asSandbox(sandbox), { A: "s1" }, OPTIONS)
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ A: "s1" })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })
})
