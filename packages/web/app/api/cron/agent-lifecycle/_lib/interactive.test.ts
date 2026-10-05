import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ persist: vi.fn(), update: vi.fn(), upsert: vi.fn(), claim: vi.fn(), release: vi.fn(), abandon: vi.fn(), failure: vi.fn(), record: vi.fn(), cancel: vi.fn(), snapshot: vi.fn(), stop: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { message: { update: mocks.update, upsert: mocks.upsert } } }))
vi.mock("@/lib/agent-session", () => ({ finalizeTurn: vi.fn(), cancelBackgroundAgent: mocks.cancel, snapshotBackgroundAgent: mocks.snapshot }))
vi.mock("@/lib/server/turn-ownership", () => ({ claimTurnFinalization: mocks.claim, releaseTurn: mocks.release, abandonFinalization: mocks.abandon }))
vi.mock("@/lib/server/turn-failure", () => ({ readTurnFailure: mocks.failure, recordTurnFailure: mocks.record }))
vi.mock("./monitor", () => ({ stopInteractiveAgent: mocks.stop }))
vi.mock("@/app/api/agent/stream/_lib/persist-snapshot", () => ({ persistAgentSnapshot: mocks.persist }))
vi.mock("@/lib/server/token-metering", () => ({ meterAssistantTurn: vi.fn() }))
vi.mock("./meter-turn", () => ({ meterTurnNow: vi.fn() }))
vi.mock("@/lib/git/auto-push", () => ({ autoPushChat: vi.fn() }))
vi.mock("@/lib/server/uncommitted-files-warning", () => ({ refreshUncommittedFilesWarning: vi.fn() }))
import { finalizeInteractiveChat, markChatError, stopInteractiveChat } from "./interactive"

const chat = { id: "chat", userId: "user", repo: "__new__", branch: null, sandboxId: "sandbox", backgroundSessionId: "session", activeAssistantMessageId: "assistant", messages: [{ id: "assistant" }] } as never
const daytona = { get: async () => ({}) } as never
const snapshot = { status: "completed" as const, content: "full answer", toolCalls: [], contentBlocks: [] }
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.claim.mockResolvedValue("claim")
  mocks.persist.mockResolvedValue({ persisted: true })
  mocks.release.mockResolvedValue(true)
  mocks.failure.mockResolvedValue(null)
  mocks.record.mockResolvedValue(true)
  mocks.snapshot.mockResolvedValue(snapshot)
})
afterEach(() => { vi.restoreAllMocks() })
describe("cron finalization durability", () => {
  it("keeps the active turn recoverable after a failed write", async () => {
    mocks.update.mockRejectedValue(new Error("Transaction expired"))
    mocks.persist.mockResolvedValue({ persisted: false })
    expect(await finalizeInteractiveChat(chat, snapshot, daytona)).toBe(false)
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.abandon).toHaveBeenCalled()
  })
  it("can retry the failed write and then release exactly once", async () => {
    mocks.persist.mockResolvedValueOnce({ persisted: false }).mockResolvedValueOnce({ persisted: true })
    expect(await finalizeInteractiveChat(chat, snapshot, daytona)).toBe(false)
    expect(await finalizeInteractiveChat(chat, snapshot, daytona)).toBe(true)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
  it("abandons a failed release so another observer can recover immediately", async () => {
    mocks.release.mockRejectedValueOnce(new Error("Database unavailable"))
    await expect(finalizeInteractiveChat(chat, snapshot, daytona)).rejects.toThrow("Database unavailable")
    expect(mocks.abandon).toHaveBeenCalledTimes(1)
  })
  it("does not report a completed turn when release no longer owns it", async () => {
    mocks.release.mockResolvedValue(false)
    expect(await finalizeInteractiveChat(chat, snapshot, daytona)).toBe(false)
    expect(mocks.abandon).toHaveBeenCalledTimes(1)
  })
  it("keeps failed error-output persistence recoverable", async () => {
    mocks.persist.mockResolvedValue({ persisted: false })
    expect(await markChatError(chat, "failure", daytona, { ...snapshot, status: "error" })).toBe(false)
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.abandon).toHaveBeenCalledTimes(1)
  })
  it("does not detach an errored turn when saving its error row fails", async () => {
    mocks.upsert.mockRejectedValue(new Error("Cannot save error"))
    await expect(markChatError(chat, "failure", daytona, { ...snapshot, status: "error" })).rejects.toThrow("Cannot save error")
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.abandon).toHaveBeenCalledTimes(1)
  })
  it("uses one stable error-row identity across a failed release and retry", async () => {
    mocks.release.mockRejectedValueOnce(new Error("Database unavailable"))
    await expect(markChatError(chat, "failure", daytona, { ...snapshot, status: "error" })).rejects.toThrow()
    expect(await markChatError(chat, "failure", daytona, { ...snapshot, status: "error" })).toBe(true)
    expect(mocks.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.upsert.mock.calls[0][0].where.id).toBe(mocks.upsert.mock.calls[1][0].where.id)
  })
  it.each(["persist", "release"])("preserves timeout intent when %s fails and the next observer sees completed", async (stage) => {
    let intent: { reason: string; executionStopped: boolean } | null = null
    mocks.record.mockImplementation(async (_turn, _claim, reason, executionStopped) => { intent = { reason, executionStopped }; return true })
    mocks.failure.mockImplementation(async () => intent)
    mocks.stop.mockImplementation(async (_sandbox, _session, _daytona, beforeCancel) => {
      await beforeCancel()
      return { snapshot, cancelled: true }
    })
    if (stage === "persist") {
      mocks.persist.mockResolvedValueOnce({ persisted: false })
      expect(await stopInteractiveChat(chat, "time limit", daytona)).toBe(false)
    } else {
      mocks.release.mockRejectedValueOnce(new Error("Database failed"))
      await expect(stopInteractiveChat(chat, "time limit", daytona)).rejects.toThrow()
    }
    expect(await finalizeInteractiveChat(chat, snapshot, daytona)).toBe(true)
    expect(mocks.release.mock.calls.at(-1)?.[2]).toBe("error")
    expect(intent).toEqual({ reason: "time limit", executionStopped: true })
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.failure.mock.invocationCallOrder[0])
  })
  it("saves the post-cancellation tail, not the earlier error snapshot", async () => {
    mocks.snapshot.mockResolvedValue({ ...snapshot, content: "output produced while stopping" })
    await markChatError(chat, "failure", daytona, { ...snapshot, status: "error", content: "partial" })
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ snapshot: expect.objectContaining({ content: "output produced while stopping" }) }))
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[1])
  })
  it("does not confirm a stopped execution if cancellation fails", async () => {
    mocks.cancel.mockRejectedValue(new Error("Stop failed"))
    await expect(markChatError(chat, "failure", daytona, snapshot)).rejects.toThrow("Stop failed")
    expect(mocks.record).toHaveBeenCalledTimes(1)
    expect(mocks.record.mock.calls[0][3]).toBe(false)
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
