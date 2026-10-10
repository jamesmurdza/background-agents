import { describe, expect, it, vi } from "vitest"
import type { Sandbox } from "@daytonaio/sdk"
import { createSandboxJobs } from "../src/jobs"
import type { JobHandle } from "../src/types"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const runShell = promisify(execFile)

const handle: JobHandle = {
  jobId: "test-job", dir: "/tmp/test-job", outputFile: "/tmp/test-job/output.log",
  exitFile: "/tmp/test-job/exit", pgid: 12345, cgroup: "/sys/fs/cgroup/test-job", processName: "test-agent",
}

describe("job cancellation acknowledgement", () => {
  it.each([
    { exitCode: 1, result: "permission denied" },
    { exitCode: 0, result: "" },
    { exitCode: 0, result: "job still running" },
  ])("rejects an unconfirmed cancellation: %j", async (result) => {
    const executeCommand = vi.fn().mockResolvedValue(result)
    const jobs = createSandboxJobs({ process: { executeCommand } } as unknown as Sandbox)
    await expect(jobs.cancel(handle)).rejects.toThrow(/confirm.*stop/i)
  })

  it("accepts a confirmed terminal process without exposing command output", async () => {
    const executeCommand = vi.fn().mockResolvedValue({ exitCode: 0, result: "SBJ-CANCELLED\n" })
    const jobs = createSandboxJobs({ process: { executeCommand } } as unknown as Sandbox)
    await expect(jobs.cancel(handle)).resolves.toBeUndefined()
    expect(executeCommand.mock.calls[0][0]).not.toContain("pkill")
  })

  it.each([
    { state: "12345 S", populated: false, stopped: false },
    { state: "12345 Z", populated: false, stopped: true },
    { state: "", populated: false, stopped: true },
    { state: "", populated: true, stopped: false },
    { state: "READ_FAILED", populated: false, stopped: false },
    { state: "", populated: null, stopped: false },
  ])("checks real shell postconditions before recording exit: %j", async ({ state, populated, stopped }) => {
    const dir = await mkdtemp(join(tmpdir(), "sandbox-cancel-contract-"))
    try {
      const local = { ...handle, exitFile: join(dir, "exit"), cgroup: join(dir, "cgroup") }
      await mkdir(local.cgroup)
      await writeFile(join(local.cgroup, "cgroup.events"), populated === null ? "invalid\n" : `populated ${populated ? 1 : 0}\n`)
      // Execute the generated shell itself, replacing only OS observations and
      // termination with deterministic fixtures. No host process is signalled.
      const executeCommand = vi.fn(async (command: string) => {
        const observe = state === "READ_FAILED" ? "return 1" : `printf '%s\\n' '${state}'`
        const stubs = `kill() { return 1; }; sudo() { return 1; }; sleep() { :; }; ps() { ${observe}; }; `
        try {
          const result = await runShell("sh", ["-c", stubs + command])
          return { exitCode: 0, result: result.stdout }
        } catch (error) {
          const failed = error as { code: number; stdout: string }
          return { exitCode: failed.code, result: failed.stdout }
        }
      })
      const jobs = createSandboxJobs({ process: { executeCommand } } as unknown as Sandbox)
      if (stopped) {
        await jobs.cancel(local)
        expect((await readFile(local.exitFile, "utf8")).trim()).toBe("143")
      } else {
        await expect(jobs.cancel(local)).rejects.toThrow(/confirm.*stop/i)
        await expect(readFile(local.exitFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
