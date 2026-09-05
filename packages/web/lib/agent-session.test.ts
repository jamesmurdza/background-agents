import { describe, it, expect, vi } from "vitest"

// snapshotBackgroundAgent only needs getSession from the SDK; stub it so we
// can control success/failure without spinning up a real sandbox.
vi.mock("@background-agents/sdk", () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
}))

import { getSession } from "@background-agents/sdk"
import { snapshotBackgroundAgent, type AgentSnapshot } from "./agent-session"

const sandbox = {} as import("@daytonaio/sdk").Sandbox

function runningSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    status: "running",
    content: "partial output written before the read failed",
    toolCalls: [{ tool: "bash", status: "running" } as unknown as AgentSnapshot["toolCalls"][number]],
    contentBlocks: [],
    sessionId: "sess-1",
    ...overrides,
  }
}

describe("snapshotBackgroundAgent", () => {
  it("preserves the previous snapshot's content when a read fails mid-turn, instead of wiping it", async () => {
    // Reproduces the bug: a transient failure reading/parsing the session
    // (sandbox blip, brief file-read race — notably possible right as the
    // agent process crashes) used to be reported as an empty, errored
    // snapshot. That fabricated emptiness then got streamed to the client and
    // persisted as the final message body, wiping a transcript that was
    // still on disk. It should instead fall back to the last known-good
    // snapshot and flag the failure so the caller can retry.
    vi.mocked(getSession).mockRejectedValueOnce(new Error("sandbox unreachable"))
    const previous = runningSnapshot()

    const snap = await snapshotBackgroundAgent(
      sandbox,
      "bg-1",
      { repoPath: "/repo" },
      previous
    )

    expect(snap.transientReadFailure).toBe(true)
    expect(snap.content).toBe(previous.content)
    expect(snap.toolCalls).toEqual(previous.toolCalls)
    expect(snap.status).toBe(previous.status)
  })

  it("falls back to an empty error snapshot (tagged transientReadFailure) when there is no previous snapshot to preserve", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error("ECONNRESET"))

    const snap = await snapshotBackgroundAgent(sandbox, "bg-1", { repoPath: "/repo" })

    expect(snap.transientReadFailure).toBe(true)
    expect(snap.status).toBe("error")
    expect(snap.content).toBe("")
  })
})
