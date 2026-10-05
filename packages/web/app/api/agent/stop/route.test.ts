import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), chat: vi.fn(), pause: vi.fn(), claim: vi.fn(), release: vi.fn(), abandon: vi.fn(),
  sandbox: vi.fn(), snapshot: vi.fn(), persist: vi.fn(), cancel: vi.fn(),
}))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class { get = mocks.sandbox } }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { chat: { findUnique: mocks.chat, updateMany: mocks.pause } } }))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: mocks.auth, isAuthError: (value: unknown) => value instanceof Response,
  badRequest: (error: string) => Response.json({ error }, { status: 400 }),
  serverConfigError: () => Response.json({ error: "configuration" }, { status: 500 }),
  internalError: () => Response.json({ error: "stop failed" }, { status: 500 }),
}))
vi.mock("@/lib/server/turn-ownership", () => ({
  claimTurnFinalization: mocks.claim, releaseTurn: mocks.release, abandonFinalization: mocks.abandon,
}))
vi.mock("@/lib/agent-session", () => ({ snapshotBackgroundAgent: mocks.snapshot, cancelBackgroundAgent: mocks.cancel }))
vi.mock("../stream/_lib/persist-snapshot", () => ({ persistAgentSnapshot: mocks.persist }))

import { POST } from "./route"

const turn = { chatId: "chat", backgroundSessionId: "session", assistantMessageId: "assistant" }
const request = () => new Request("http://localhost/api/agent/stop", { method: "POST", body: JSON.stringify(turn) })
const output = { status: "completed", content: "partial answer", toolCalls: [], contentBlocks: [], sessionId: "provider-session" }

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("DAYTONA_API_KEY", "test-only")
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.auth.mockResolvedValue({ userId: "owner" })
  mocks.chat.mockResolvedValue({ userId: "owner", status: "running", sandboxId: "sandbox", backgroundSessionId: "session", activeAssistantMessageId: "assistant" })
  mocks.pause.mockResolvedValue({ count: 1 })
  mocks.claim.mockResolvedValue("claim")
  mocks.release.mockResolvedValue(true)
  mocks.sandbox.mockResolvedValue({ id: "sandbox" })
  mocks.snapshot.mockResolvedValue(output)
  mocks.persist.mockResolvedValue({ persisted: true })
  mocks.cancel.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("explicit Stop preserves output before releasing the owned turn", () => {
  it.each([null, {}, { ...turn, chatId: 123 }, { ...turn, assistantMessageId: [] }])("rejects an invalid turn identity before database access: %j", async (body) => {
    const req = new Request("http://localhost/api/agent/stop", { method: "POST", body: JSON.stringify(body) })
    expect((await POST(req)).status).toBe(400)
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it("saves before cancellation and again after it, then releases", async () => {
    const events: string[] = []
    mocks.snapshot.mockImplementation(async () => { events.push("snapshot"); return output })
    mocks.persist.mockImplementation(async () => { events.push("persist"); return { persisted: true } })
    mocks.cancel.mockImplementation(async () => { events.push("cancel") })
    mocks.release.mockImplementation(async () => { events.push("release"); return true })
    expect((await POST(request())).status).toBe(200)
    expect(events).toEqual(["snapshot", "persist", "cancel", "snapshot", "persist", "release"])
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ turn, finalizationClaimId: "claim", snapshot: output }))
    expect(mocks.cancel).toHaveBeenCalledWith(expect.anything(), "session", expect.objectContaining({ repoPath: expect.stringMatching(/\/project$/) }), true)
    expect(mocks.release).toHaveBeenCalledWith(turn, "claim", "ready", "provider-session", { pauseQueue: true })
  })

  it.each(["stale turn", "other owner", "already finalizing"])("does not cancel a %s", async (scenario) => {
    if (scenario === "stale turn") mocks.chat.mockResolvedValue({ userId: "owner", status: "running", sandboxId: "sandbox", backgroundSessionId: "new-session", activeAssistantMessageId: "new-assistant" })
    if (scenario === "other owner") mocks.auth.mockResolvedValue({ userId: "someone-else" })
    if (scenario === "already finalizing") mocks.claim.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(scenario === "other owner" ? 400 : 409)
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it.each(["initial read", "initial save", "cancel", "final read", "still running", "final save"])("does not report success or release after failed %s", async (stage) => {
    if (stage === "initial read") mocks.snapshot.mockResolvedValueOnce({ ...output, transientReadFailure: true })
    if (stage === "initial save") mocks.persist.mockResolvedValueOnce({ persisted: false })
    if (stage === "cancel") mocks.cancel.mockRejectedValueOnce(new Error("transport unavailable"))
    if (stage === "final read") mocks.snapshot.mockResolvedValueOnce(output).mockResolvedValueOnce({ ...output, transientReadFailure: true })
    if (stage === "still running") mocks.snapshot.mockResolvedValueOnce(output).mockResolvedValueOnce({ ...output, status: "running" })
    if (stage === "final save") mocks.persist.mockResolvedValueOnce({ persisted: true }).mockResolvedValueOnce({ persisted: false })
    expect((await POST(request())).status).toBe(500)
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.abandon).toHaveBeenCalledWith(turn, "claim")
    if (stage.startsWith("initial")) expect(mocks.cancel).not.toHaveBeenCalled()
  })
})
