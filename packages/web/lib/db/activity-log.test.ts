import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so logLlmProviderError can be exercised without a
// DB. `vi.hoisted` lets the factory (hoisted above imports) see the mock.
const { activityLog } = vi.hoisted(() => ({
  activityLog: { create: vi.fn() },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { activityLog } }))

import { logLlmProviderError } from "./activity-log"

// logActivityAsync is fire-and-forget; flush the microtask queue so the
// create() call has run before we assert.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  activityLog.create.mockReset()
  activityLog.create.mockResolvedValue({})
})

describe("logLlmProviderError", () => {
  it("records a provider error and classifies its category", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "opencode",
      model: "gpt-5",
      chatId: "c1",
      source: "stream",
      error: "AI_APICallError: insufficient balance (402)",
    })
    await flush()

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.userId).toBe("u1")
    expect(data.action).toBe("llm_provider_error")
    expect(data.metadata).toMatchObject({
      category: "balance",
      agent: "opencode",
      model: "gpt-5",
      chatId: "c1",
      source: "stream",
    })
    expect(data.metadata.message).toContain("insufficient balance")
  })

  it("skips a bare process crash that carries no provider detail", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "claude-code",
      source: "cron-interactive",
      error: "Process exited without completing",
      errorKind: "crash",
    })
    await flush()

    expect(activityLog.create).not.toHaveBeenCalled()
  })

  it("still records a crash when its captured detail is a real provider failure", async () => {
    logLlmProviderError({
      userId: "u1",
      agent: "claude-code",
      source: "cron-interactive",
      error: "Process exited without completing\n\nInvalid API key: 401 Unauthorized",
      errorKind: "crash",
    })
    await flush()

    expect(activityLog.create).toHaveBeenCalledTimes(1)
    const { data } = activityLog.create.mock.calls[0][0]
    expect(data.metadata.category).toBe("auth")
  })
})
