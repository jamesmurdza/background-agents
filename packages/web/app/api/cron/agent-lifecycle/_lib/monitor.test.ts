/**
 * Tests for the session id the monitor hands to its failure handlers.
 *
 * Two different ids travel through this module and they are easy to confuse:
 *
 *   backgroundSessionId  the Daytona handle used to talk to the sandbox
 *   snapshot.sessionId   the agent CLI's own session, which is what tokscale
 *                        files token usage under
 *
 * Billing a turn needs the second one. tokscale matches on it exactly, so the
 * first one selects nothing and meters zero — with no error and no row to show
 * for it. In production the two have never coincided: no TokenUsage row has
 * ever carried a value that appears as a backgroundSessionId.
 *
 * monitorAgent and stopAgent are the only places the agent id is known at
 * failure time, so what is pinned here is that they surrender it to the caller.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { AgentSnapshot } from "@/lib/agent-session"

const BACKGROUND_SESSION_ID = "64b0cd9f-807c-42f3-bcf1-000000000000"
const AGENT_SESSION_ID = "ses_0f954b136ffe7xPfv2"

let snapshot: AgentSnapshot
const cancelBackgroundAgent = vi.fn(async () => {})
const snapshotBackgroundAgent = vi.fn(async () => snapshot)

vi.mock("@/lib/agent-session", () => ({
  snapshotBackgroundAgent: (...a: unknown[]) => snapshotBackgroundAgent(...(a as [])),
  cancelBackgroundAgent: (...a: unknown[]) => cancelBackgroundAgent(...(a as [])),
}))

import { monitorAgent, stopAgent, stopInteractiveAgent } from "./monitor"

const sandbox = { refreshActivity: vi.fn(async () => {}) }
const daytona = { get: vi.fn(async () => sandbox) } as never

beforeEach(() => {
  vi.clearAllMocks()
  snapshot = {
    status: "error",
    content: "partial output",
    toolCalls: [],
    contentBlocks: [],
    error: "Agent stopped without completing",
    sessionId: AGENT_SESSION_ID,
  }
})

describe("monitorAgent", () => {
  it("hands the failure handler the snapshot, so it can bill the dying turn", async () => {
    const onError = vi.fn(async () => {})
    await monitorAgent(BACKGROUND_SESSION_ID, BACKGROUND_SESSION_ID, daytona, {
      onComplete: vi.fn(async () => {}),
      onError,
    })

    const [, , passed] = onError.mock.calls[0] as unknown as [string, unknown, AgentSnapshot]
    expect(passed.sessionId).toBe(AGENT_SESSION_ID)
    expect(passed.sessionId).not.toBe(BACKGROUND_SESSION_ID)
  })

  it("still reports the error text and kind alongside it", async () => {
    snapshot = { ...snapshot, error: "Rate limit exceeded", errorKind: "crash" }
    const onError = vi.fn(async () => {})
    await monitorAgent(BACKGROUND_SESSION_ID, BACKGROUND_SESSION_ID, daytona, {
      onComplete: vi.fn(async () => {}),
      onError,
    })
    expect(onError.mock.calls[0].slice(0, 2)).toEqual(["Rate limit exceeded", "crash"])
  })

  it("does not call the failure handler while the agent is still running", async () => {
    snapshot = { ...snapshot, status: "running", error: undefined }
    const onError = vi.fn(async () => {})
    await monitorAgent(BACKGROUND_SESSION_ID, BACKGROUND_SESSION_ID, daytona, {
      onComplete: vi.fn(async () => {}),
      onError,
    })
    expect(onError).not.toHaveBeenCalled()
  })
})

describe("stopAgent", () => {
  it("returns the agent session id so a hard timeout can still be billed", async () => {
    // A 25-minute run is the most expensive kind of failure there is; losing
    // its id means losing the whole turn's usage.
    await expect(
      stopAgent("sandbox_1", BACKGROUND_SESSION_ID, daytona)
    ).resolves.toBe(AGENT_SESSION_ID)
  })

  it("reads the id BEFORE cancelling — a cancelled session may not report it", async () => {
    const order: string[] = []
    snapshotBackgroundAgent.mockImplementationOnce(async () => {
      order.push("read-id")
      return snapshot
    })
    cancelBackgroundAgent.mockImplementationOnce(async () => {
      order.push("cancel")
    })
    await stopAgent("sandbox_1", BACKGROUND_SESSION_ID, daytona)
    expect(order).toEqual(["read-id", "cancel"])
  })

  it("still cancels when the id cannot be read", async () => {
    snapshotBackgroundAgent.mockRejectedValueOnce(new Error("sandbox unreachable"))
    await expect(
      stopAgent("sandbox_1", BACKGROUND_SESSION_ID, daytona)
    ).resolves.toBeUndefined()
    // Stopping a runaway agent matters more than billing it.
    expect(cancelBackgroundAgent).toHaveBeenCalledTimes(1)
  })
})

describe("interactive cancellation confirmation", () => {
  it("does not cancel a turn that completed before the timeout stop arrived", async () => {
    snapshot = { ...snapshot, status: "completed" }
    expect(await stopInteractiveAgent("sandbox", BACKGROUND_SESSION_ID, daytona)).toEqual({ snapshot, cancelled: false })
    expect(cancelBackgroundAgent).not.toHaveBeenCalled()
  })
  it("returns the last output after confirmed cancellation", async () => {
    snapshotBackgroundAgent.mockResolvedValueOnce({ ...snapshot, status: "running", content: "partial" })
    snapshotBackgroundAgent.mockResolvedValueOnce({ ...snapshot, content: "last output" })
    expect(await stopInteractiveAgent("sandbox", BACKGROUND_SESSION_ID, daytona)).toMatchObject({ snapshot: { content: "last output" }, cancelled: true })
    expect(cancelBackgroundAgent).toHaveBeenCalledWith(sandbox, BACKGROUND_SESSION_ID, expect.anything(), true)
  })
  it("propagates failed cancellation instead of reporting the turn stopped", async () => {
    snapshot = { ...snapshot, status: "running" }
    cancelBackgroundAgent.mockRejectedValueOnce(new Error("Cannot stop"))
    await expect(stopInteractiveAgent("sandbox", BACKGROUND_SESSION_ID, daytona)).rejects.toThrow("Cannot stop")
  })
  it.each([
    { status: "running" as const },
    { status: "error" as const, transientReadFailure: true },
  ])("rejects an unconfirmed post-stop snapshot: %j", async (after) => {
    snapshotBackgroundAgent.mockResolvedValueOnce({ ...snapshot, status: "running" })
    snapshotBackgroundAgent.mockResolvedValueOnce({ ...snapshot, ...after })
    await expect(stopInteractiveAgent("sandbox", BACKGROUND_SESSION_ID, daytona)).rejects.toThrow("Cannot confirm")
  })
  it("does not invoke the interactive error finalizer after cancellation fails", async () => {
    const onError = vi.fn()
    cancelBackgroundAgent.mockRejectedValueOnce(new Error("Cannot stop"))
    await monitorAgent("sandbox", BACKGROUND_SESSION_ID, daytona, { strictCancellation: true, onComplete: vi.fn(), onError })
    expect(onError).not.toHaveBeenCalled()
  })
})
