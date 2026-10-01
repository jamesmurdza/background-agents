import { describe, expect, it } from "vitest"
import { createBackgroundSession } from "../src/background/session"
import type { AgentDefinition } from "../src/core/agent"
import type { CodeAgentSandbox } from "../src/types/provider"
import type { JobHandle, SandboxJobs } from "@background-agents/sandbox-jobs"

describe("background session startup", () => {
  it("does not expose a job handle to concurrent readers before its metadata is durable", async () => {
    const handle: JobHandle = {
      jobId: "job-1", dir: "/tmp/codeagent-test/job-1", outputFile: "/tmp/codeagent-test/job-1/output.log",
      exitFile: "/tmp/codeagent-test/job-1/exit", pgid: 1, cgroup: "/test",
    }
    let meta: Record<string, unknown> = { currentTurn: 0, provider: "test", sessionId: null }
    let allowJobMetadata!: () => void
    const jobMetadataGate = new Promise<void>((resolve) => { allowJobMetadata = resolve })
    let jobWriteStarted!: () => void
    const jobWriteStartedPromise = new Promise<void>((resolve) => { jobWriteStarted = resolve })
    let reads = 0

    const jobs = {
      start: async () => handle,
      read: async () => {
        reads++
        return { raw: "", cursor: 0, bytesFetched: 0, status: { state: "running", exitCode: null, alive: true } }
      },
      attach: async () => null,
    } as unknown as SandboxJobs
    const sandbox = {
      jobs,
      executeCommand: async (command: string) => {
        if (command.startsWith("cat ")) return { exitCode: 0, output: JSON.stringify(meta) }
        const encoded = command.match(/printf %s '([^']+)'/)?.[1]
        if (!encoded) throw new Error(`Unexpected command: ${command}`)
        const next = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown>
        if (next.jobId) {
          jobWriteStarted()
          await jobMetadataGate
        }
        meta = next
        return { exitCode: 0, output: "" }
      },
    } as CodeAgentSandbox
    const agent = {
      name: "test",
      toolMappings: {},
      buildCommand: () => ({ cmd: "true", args: [] }),
      parse: () => null,
    } satisfies AgentDefinition
    const session = createBackgroundSession(agent, sandbox, "/tmp/codeagent-test")

    const starting = session.start("hello")
    await jobWriteStartedPromise
    const concurrentSnapshot = await session.getSnapshot()
    expect(concurrentSnapshot.runPhase).toBe("idle")
    expect(reads).toBe(0)

    allowJobMetadata()
    await starting
    expect(meta.jobId).toBe(handle.jobId)
  })
})
