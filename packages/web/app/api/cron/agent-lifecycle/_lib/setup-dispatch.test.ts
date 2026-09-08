import { describe, it, expect, vi, beforeEach } from "vitest"

const findMany = vi.fn()
const chatUpdate = vi.fn()
const dispatchQueuedTurn = vi.fn()
const ensureSandboxStarted = vi.fn()
const daytonaGet = vi.fn()
const jobStatus = vi.fn()
const jobRead = vi.fn()

vi.mock("@/lib/db/prisma", () => ({
  prisma: { chat: { findMany, update: chatUpdate } },
}))
vi.mock("@background-agents/sandbox-jobs", () => ({
  createSandboxJobs: () => ({ status: jobStatus, read: jobRead }),
}))
vi.mock("@/lib/sandbox", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sandbox")>("@/lib/sandbox")
  return { isSandboxGoneError: actual.isSandboxGoneError, ensureSandboxStarted }
})
vi.mock("@/lib/server/dispatch-setup-turn", () => ({
  dispatchQueuedTurn,
  finishSetupRecord: (r: object) => ({ ...r, state: "exited", exitCode: 0 }),
  DISPATCH_CLAIM_TTL_MS: 5 * 60 * 1000,
}))

const { dispatchFinishedSetups } = await import("./setup-dispatch")

const daytona = { get: daytonaGet } as never
const NOW = new Date(1_700_000_000_000)

function chatRow(setupRunOverrides: Record<string, unknown> = {}) {
  return {
    id: "chat_1",
    userId: "user_1",
    sandboxId: "sbx_1",
    setupRun: {
      handle: { jobId: "job_1" },
      environmentId: "env_1",
      writtenHash: "abc",
      startedAt: 1,
      ...setupRunOverrides,
    },
  }
}

function results() {
  return { dispatchedAfterSetup: 0, errors: [] as string[] }
}

describe("dispatchFinishedSetups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMany.mockResolvedValue([chatRow()])
    chatUpdate.mockResolvedValue({})
    ensureSandboxStarted.mockResolvedValue(undefined)
    daytonaGet.mockResolvedValue({})
    jobStatus.mockResolvedValue({ state: "exited", exitCode: 0, alive: false })
    jobRead.mockResolvedValue({ raw: "done\n" })
    dispatchQueuedTurn.mockResolvedValue(true)
  })

  it("dispatches a chat whose job has exited", async () => {
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(ensureSandboxStarted).toHaveBeenCalledTimes(1)
    expect(dispatchQueuedTurn).toHaveBeenCalledTimes(1)
    expect(r.dispatchedAfterSetup).toBe(1)
    expect(r.errors).toEqual([])
  })

  it("leaves a still-running job alone", async () => {
    jobStatus.mockResolvedValue({ state: "running", exitCode: null, alive: true })
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(dispatchQueuedTurn).not.toHaveBeenCalled()
    expect(r.errors).toEqual([])
  })

  it("skips a chat whose claim is still live", async () => {
    findMany.mockResolvedValue([chatRow({ claimedAt: NOW.getTime() - 1_000 })])
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(daytonaGet).not.toHaveBeenCalled()
    expect(dispatchQueuedTurn).not.toHaveBeenCalled()
  })

  it("re-claims a chat whose claim has gone stale", async () => {
    findMany.mockResolvedValue([
      chatRow({ claimedAt: NOW.getTime() - 6 * 60 * 1000 }),
    ])
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(dispatchQueuedTurn).toHaveBeenCalledTimes(1)
    expect(r.dispatchedAfterSetup).toBe(1)
  })

  it("marks the chat errored when the sandbox genuinely no longer exists (404)", async () => {
    daytonaGet.mockRejectedValue(Object.assign(new Error("Sandbox gone"), { statusCode: 404 }))
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(chatUpdate).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: { status: "error" },
    })
    expect(r.errors[0]).toContain("no longer exists")
  })

  it("leaves the chat in setting_up when Daytona 500s, so the next tick retries", async () => {
    // One bad minute of upstream weather must not discard every in-flight
    // setup in the system.
    daytonaGet.mockRejectedValue(
      Object.assign(new Error("Internal Server Error"), { statusCode: 500 })
    )
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(chatUpdate).not.toHaveBeenCalled()
    expect(dispatchQueuedTurn).not.toHaveBeenCalled()
    expect(r.errors[0]).toContain("Internal Server Error")
  })

  it("leaves the chat in setting_up on a network-shaped error with no status code", async () => {
    daytonaGet.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.1:443"))
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(chatUpdate).not.toHaveBeenCalled()
    expect(r.errors[0]).toContain("ETIMEDOUT")
  })

  it("leaves the chat in setting_up when the sandbox cannot be started", async () => {
    ensureSandboxStarted.mockRejectedValue(new Error("state change in progress"))
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(chatUpdate).not.toHaveBeenCalled()
    expect(dispatchQueuedTurn).not.toHaveBeenCalled()
    expect(r.errors).toHaveLength(1)
  })

  it("unsticks a chat whose record has no job handle", async () => {
    const row = chatRow()
    delete (row.setupRun as Record<string, unknown>).handle
    findMany.mockResolvedValue([row])
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(daytonaGet).not.toHaveBeenCalled()
    expect(dispatchQueuedTurn).toHaveBeenCalledTimes(1)
    expect(r.dispatchedAfterSetup).toBe(1)
  })

  it("reports a chat stuck in setting_up with an unusable record", async () => {
    findMany.mockResolvedValue([{ id: "chat_1", userId: "u", sandboxId: "s", setupRun: null }])
    const r = results()
    await dispatchFinishedSetups(daytona, NOW, r)

    expect(dispatchQueuedTurn).not.toHaveBeenCalled()
    expect(r.errors[0]).toContain("no usable setup run")
  })
})
