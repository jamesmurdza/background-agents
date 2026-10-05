import { afterEach, describe, expect, it, vi } from "vitest"
import { createBackgroundSession } from "../src/background/session"
import type { AgentDefinition } from "../src/core/agent"
import type { CodeAgentSandbox } from "../src/types/provider"
import type { JobHandle, SandboxJobs } from "@background-agents/sandbox-jobs"

afterEach(() => vi.restoreAllMocks())

describe("background session cancellation", () => {
  it.each([false, true])("records cancellation only after the process confirms it: success=%s", async (success) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const handle = { jobId: "job-1" } as JobHandle
    let meta: Record<string, unknown> = { currentTurn: 1, jobId: "job-1", cancelled: false }
    const jobs = {
      attach: async () => handle,
      cancel: async () => { if (!success) throw new Error("Cancellation not confirmed") },
      read: async () => ({ raw: "process failed\n", cursor: 15, bytesFetched: 15, status: { state: "exited", exitCode: 1, alive: false } }),
    } as unknown as SandboxJobs
    const sandbox = {
      jobs,
      executeCommand: async (command: string) => {
        if (command.startsWith("cat ")) return { exitCode: 0, output: JSON.stringify(meta) }
        const encoded = command.match(/printf %s '([^']+)'/)?.[1]
        if (!encoded) throw new Error("Unexpected metadata command")
        meta = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
        return { exitCode: 0, output: "" }
      },
    } as CodeAgentSandbox
    const agent = { name: "test", toolMappings: {}, buildCommand: () => ({ cmd: "true", args: [] }), parse: () => null } satisfies AgentDefinition
    const session = createBackgroundSession(agent, sandbox, "/tmp/codeagent-test")

    if (success) await session.cancel()
    else await expect(session.cancel()).rejects.toThrow("Cancellation not confirmed")
    expect(meta.cancelled).toBe(success)
    const snapshot = await session.getSnapshot()
    // A failed Stop must not suppress a later real crash as a user cancellation.
    expect(snapshot.events.some((event) => event.type === "agent_crashed")).toBe(!success)
  })
})
