import { describe, expect, it } from "vitest"
import { createBackgroundSession, writeInitialSessionMeta } from "../src/background/session"
import type { SessionMeta } from "../src/background/types"
import type { AgentDefinition } from "../src/core/agent"
import type { CodeAgentSandbox } from "../src/types/provider"
import type { JobHandle, SandboxJobs } from "@background-agents/sandbox-jobs"

const directory = "/tmp/codeagent-launch-contract"
const agent = { name: "test", toolMappings: {}, buildCommand: () => ({ cmd: "true", args: [] }), parse: () => null } satisfies AgentDefinition

function fixture() {
  let meta: SessionMeta | null = null
  let writeFailure = false
  let launchResponseLost = false
  let cancelFailure = false
  const executions = new Map<string, JobHandle>()
  const aborted = new Set<string>()
  const stopped = new Set<string>()
  const jobs: SandboxJobs = {
    async start(options) {
      const id = options.jobId!
      if (aborted.has(id)) throw new Error("Attempt cancelled")
      const handle = executions.get(id) ?? { jobId: id, pgid: executions.size + 100,
        dir: `${directory}/${id}`, outputFile: `${directory}/${id}/output.log`, exitFile: `${directory}/${id}/exit`, cgroup: `/test/${id}` }
      executions.set(id, handle)
      if (launchResponseLost) throw new Error("Launch response lost")
      return handle
    },
    async attach(id) { return executions.get(id) ?? null },
    async status(handle) { return stopped.has(handle.jobId) ? { state: "exited", alive: false, exitCode: 0 } : { state: "running", alive: true, exitCode: null } },
    async read(handle) { return { raw: "", cursor: 0, bytesFetched: 0, status: await jobs.status(handle) } },
    async cancel(handle) { if (cancelFailure) throw new Error("Unconfirmed cancel"); stopped.add(handle.jobId) },
    async abort(id) { aborted.add(id); const handle = executions.get(id); if (handle) await jobs.cancel(handle) },
    async isAborted(id) { return aborted.has(id) },
  }
  const sandbox = {
    jobs,
    async executeCommand(command: string) {
      if (command.startsWith("cat ")) return { exitCode: meta ? 0 : 44, output: meta ? JSON.stringify(meta) : "" }
      if (writeFailure) return { exitCode: 1, output: "" }
      const encoded = [...command.matchAll(/printf %s '([^']+)'/g)].at(-1)?.[1]
      if (!encoded) throw new Error("Unexpected metadata operation")
      meta = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as SessionMeta
      return { exitCode: 0, output: "" }
    },
  } as CodeAgentSandbox
  return { sandbox, jobs, executions, stopped, meta: () => meta,
    failWrites: () => { writeFailure = true }, loseResponse: () => { launchResponseLost = true },
    failCancel: () => { cancelFailure = true }, restoreResponse: () => { launchResponseLost = false },
    session: () => createBackgroundSession(agent, sandbox, directory),
  }
}

describe("background launch recovery", () => {
  it("passes the saved native session to the adapter after reconnect", async () => {
    const test = fixture()
    await writeInitialSessionMeta(test.sandbox, directory, agent.name, "native-conversation")
    let received: string | undefined
    const resumingAgent: AgentDefinition = { ...agent, buildCommand(options) {
      received = options.sessionId
      return { cmd: "true", args: [] }
    } }
    await createBackgroundSession(resumingAgent, test.sandbox, directory).start("continue")
    expect(received).toBe("native-conversation")
  })
  it("prepares a known attempt before launch and exposes a recoverable idle snapshot", async () => {
    const test = fixture()
    await writeInitialSessionMeta(test.sandbox, directory, agent.name, null)
    const prepared = test.meta()!
    expect(prepared.jobId).toBeTruthy()
    expect(prepared.launchProtocol).toBe(1)
    expect(await test.session().getSnapshot()).toMatchObject({ runPhase: "idle", launchPreparedAt: prepared.launchPreparedAt })
    expect(test.executions.size).toBe(0)
  })

  it("does not launch user code when saving its identity fails", async () => {
    const test = fixture()
    test.failWrites()
    await expect(test.session().start("hello")).rejects.toThrow(/saved/)
    expect(test.executions.size).toBe(0)
  })

  it("cold-reconnects after a lost start response without launching another job", async () => {
    const test = fixture()
    await writeInitialSessionMeta(test.sandbox, directory, agent.name, null)
    test.loseResponse()
    await expect(test.session().start("hello")).rejects.toThrow("Launch response lost")
    const cold = test.session()
    expect((await cold.getSnapshot()).running).toBe(true)
    test.restoreResponse()
    await cold.start("hello")
    expect(test.executions.size).toBe(1)
  })

  it("cancels a never-started attempt and rejects a delayed starter", async () => {
    const test = fixture()
    await writeInitialSessionMeta(test.sandbox, directory, agent.name, null)
    const delayed = test.session()
    await test.session().cancel()
    await expect(delayed.start("hello")).rejects.toThrow(/cancelled/)
    expect(await test.session().getSnapshot()).toMatchObject({ runPhase: "stopped", running: false })
    expect(test.executions.size).toBe(0)
  })

  it("does not report a live process stopped when cancellation fails", async () => {
    const test = fixture()
    const session = test.session()
    await session.start("hello")
    test.failCancel()
    await expect(test.session().cancel()).rejects.toThrow("Unconfirmed cancel")
    expect((await test.session().getSnapshot()).running).toBe(true)
    expect(test.meta()?.cancelled).toBe(false)
  })

  it("allows acknowledged sequential turns but refuses overlapping warm starts", async () => {
    const test = fixture()
    const session = test.session()
    const first = await session.start("one")
    await expect(session.start("two")).rejects.toThrow(/still running/)
    test.stopped.add(first.executionId)
    const second = await session.start("two")
    expect(second.executionId).not.toBe(first.executionId)
    expect(test.executions.size).toBe(2)
  })

  it("keeps the turn running after an end event until the owned process exits", async () => {
    const test = fixture()
    const parsingAgent: AgentDefinition = { ...agent, parse: () => ({ type: "end" }) }
    const session = createBackgroundSession(parsingAgent, test.sandbox, directory)
    const handle = await session.start("one")
    test.jobs.read = async (job) => ({ raw: "end\n", cursor: 4, bytesFetched: 4, status: await test.jobs.status(job) })
    expect(await session.getSnapshot()).toMatchObject({ running: true, events: [{ type: "end" }] })
    test.stopped.add(handle.executionId)
    expect(await session.getSnapshot()).toMatchObject({ running: false, runPhase: "stopped" })
  })
})
