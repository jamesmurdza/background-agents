import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findChats: vi.fn(), monitor: vi.fn(), stop: vi.fn(), stopInteractive: vi.fn(),
  finalize: vi.fn(), markError: vi.fn(), credit: vi.fn(),
}))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class {} }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  scheduledJob: { findMany: async () => [] },
  scheduledJobRun: { findMany: async () => [] },
  chat: { findMany: mocks.findChats },
} }))
vi.mock("@/lib/db/activity-log", () => ({ logLlmProviderError: vi.fn() }))
vi.mock("@/lib/db/usage-limit", () => ({ UsageLimitError: class extends Error {} }))
vi.mock("./_lib/monitor", () => ({ monitorAgent: mocks.monitor, stopAgent: mocks.stop, stopInteractiveAgent: mocks.stopInteractive }))
vi.mock("./_lib/interactive", () => ({ finalizeInteractiveChat: mocks.finalize, markChatError: mocks.markError, stopInteractiveChat: mocks.stopInteractive }))
vi.mock("./_lib/credit-guard", () => ({ creditBudgetExhausted: mocks.credit, CREDIT_GUARD_STOP_REASON: "Out of credits" }))
vi.mock("./_lib/scheduled", () => ({ startJobExecution: vi.fn(), finalizeScheduledRun: vi.fn(), failScheduledRun: vi.fn() }))
import { GET } from "./route"

const snapshot = { status: "completed", content: "full answer", toolCalls: [], contentBlocks: [] }
const chat = { id: "chat", userId: "user", agent: "opencode", sandboxId: "sandbox", backgroundSessionId: "background", activeAssistantMessageId: "assistant", messages: [{ id: "assistant", createdAt: new Date(Date.now() - 60 * 60 * 1000) }], user: { plan: "free", isAdmin: false, settings: {} } }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("DAYTONA_API_KEY", "test-key-not-used")
  vi.stubEnv("CRON_SECRET", "")
  mocks.findChats.mockResolvedValue([chat])
  mocks.finalize.mockResolvedValue(true)
  mocks.markError.mockResolvedValue(true)
  mocks.credit.mockResolvedValue(false)
})
afterEach(() => { vi.unstubAllEnvs() })
describe("interactive lifecycle recovery", () => {
  it.each([true, false])("reads completed output before timeout, even when saving succeeds=%s", async (saved) => {
    mocks.finalize.mockResolvedValue(saved)
    mocks.monitor.mockImplementation(async (_s, _b, _d, handlers) => {
      await handlers.onComplete(snapshot)
      return snapshot
    })
    const result = await (await GET(new Request("http://localhost/api/cron/agent-lifecycle"))).json()
    expect(mocks.finalize).toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.stopInteractive).not.toHaveBeenCalled()
    expect(mocks.markError).not.toHaveBeenCalled()
    expect(result.timedOutInteractive).toBe(0)
    expect(result.completedInteractive).toBe(saved ? 1 : 0)
  })
  it("retains an unreadable session rather than discarding it as a timeout", async () => {
    mocks.monitor.mockResolvedValue(undefined)
    await GET(new Request("http://localhost/api/cron/agent-lifecycle"))
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.stopInteractive).not.toHaveBeenCalled()
    expect(mocks.markError).not.toHaveBeenCalled()
  })
  it("does not mark an active turn stopped if cancellation fails", async () => {
    mocks.monitor.mockResolvedValue({ ...snapshot, status: "running" })
    mocks.stopInteractive.mockRejectedValue(new Error("Cancellation failed"))
    const result = await (await GET(new Request("http://localhost/api/cron/agent-lifecycle"))).json()
    expect(mocks.markError).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(1)
  })
  it("delegates timeout to the claimed stop-and-save finalizer", async () => {
    mocks.monitor.mockResolvedValue({ ...snapshot, status: "running" })
    mocks.stopInteractive.mockResolvedValue(true)
    const result = await (await GET(new Request("http://localhost/api/cron/agent-lifecycle"))).json()
    expect(mocks.stopInteractive).toHaveBeenCalledWith(chat, expect.stringContaining("minute limit"), expect.anything())
    expect(result.timedOutInteractive).toBe(1)
  })
})
