import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Sandbox } from "@daytonaio/sdk"
import { afterEach, describe, expect, it } from "vitest"
import { createSandboxJobs } from "../src/jobs"

const run = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

/** Run the generated shell and real subprocesses. Only privileged cgroups are
 * emulated; Perl supplies the same OS flock/setsid primitives on macOS. */
async function localSandbox(cgroupJoinError?: string) {
  const root = await mkdtemp(join(tmpdir(), "job-launch-contract-"))
  const bin = join(root, "bin")
  await mkdir(bin)
  await writeFile(join(bin, "setsid"), "#!/usr/bin/perl\nuse POSIX (); POSIX::setsid() >= 0 or die $!; exec @ARGV;\n", { mode: 0o755 })
  await writeFile(join(bin, "flock"), "#!/usr/bin/perl\nuse Fcntl qw(:flock); my $unlock = grep { $_ eq '-u' } @ARGV; my $fd = $ARGV[-1]; open(my $h, '<&=', $fd) or die $!; flock($h, $unlock ? LOCK_UN : LOCK_EX) or die $!;\n", { mode: 0o755 })
  // sudo is irrelevant to process groups; cgroup directories are temporary.
  await writeFile(join(bin, "sudo"), cgroupJoinError
    ? `#!/bin/sh\nprintf '%s\\n' '${cgroupJoinError}' >&2\nexit 1\n`
    : "#!/bin/sh\n[ \"$1\" = -n ] && shift\nif [ \"$1\" = mkdir ]; then \"$@\" || exit $?; for LAST; do :; done; printf 'populated 0\\n' > \"$LAST/cgroup.events\"; else \"$@\"; fi\n", { mode: 0o755 })
  let loseResponse = false
  const commands: string[] = []
  const sandbox = { process: { executeCommand: async (command: string, _cwd?: string, env?: Record<string, string>) => {
    commands.push(command)
    const script = command.replaceAll("/sys/fs/cgroup/", `${root}/cgroups/`)
    try {
      // Like the Daytona daemon: the request's env is merged into the shell's.
      const result = await run("sh", ["-c", script], { env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` }, timeout: 15_000 })
      if (loseResponse && command.includes("setsid ")) { loseResponse = false; throw new Error("Lost launch response") }
      return { result: result.stdout, exitCode: 0 }
    } catch (error) {
      if (error instanceof Error && error.message === "Lost launch response") throw error
      const failure = error as { code: number; stdout: string }
      return { result: failure.stdout ?? "", exitCode: typeof failure.code === "number" ? failure.code : 1 }
    }
  } } } as unknown as Sandbox
  const jobs = createSandboxJobs(sandbox)
  // Tests use bounded commands; terminate each known process group before
  // deleting its fixture, even when an assertion fails.
  const handles: Array<{ pgid: number }> = []
  cleanups.push(async () => {
    for (const handle of handles) { try { process.kill(-handle.pgid, "SIGKILL") } catch {} }
    await rm(root, { recursive: true, force: true })
  })
  return { root, jobs, sandbox, handles, commands, loseNextResponse: () => { loseResponse = true } }
}

describe("durable launch identity", () => {
  it("reattaches a retry to the same execution instead of starting it twice", async () => {
    const test = await localSandbox()
    const options = { jobId: "known-attempt", root: test.root, command: "echo started; sleep 3" }
    const first = await test.jobs.start(options); test.handles.push(first)
    const second = await createSandboxJobs(test.sandbox).start(options); test.handles.push(second)
    expect(first.jobId).toBe(options.jobId)
    expect(second.pgid).toBe(first.pgid)
    expect(await readFile(first.outputFile, "utf8")).toBe("started\n")
  })

  it("can find a launched job after the launch response is lost", async () => {
    const test = await localSandbox()
    test.loseNextResponse()
    await expect(test.jobs.start({ jobId: "lost-response", root: test.root, command: "echo started; sleep 3" })).rejects.toThrow()
    const attached = await createSandboxJobs(test.sandbox).attach("lost-response", test.root)
    expect(attached).not.toBeNull()
    if (attached) test.handles.push(attached)
    expect(attached && (await test.jobs.status(attached)).alive).toBe(true)
  })

  it("rejects different work submitted with an already-used attempt id", async () => {
    const test = await localSandbox()
    const first = await test.jobs.start({ jobId: "bound-command", root: test.root, command: "echo first; sleep 3" })
    test.handles.push(first)
    await expect(test.jobs.start({ jobId: "bound-command", root: test.root, command: "echo second" })).rejects.toThrow(/different command/)
    expect(await readFile(first.outputFile, "utf8")).toBe("first\n")
  })

  it("fences a never-started attempt before a delayed launcher arrives", async () => {
    const test = await localSandbox()
    await test.jobs.abort("aborted-attempt", test.root)
    expect(await test.jobs.isAborted("aborted-attempt", test.root)).toBe(true)
    await expect(test.jobs.start({ jobId: "aborted-attempt", root: test.root, command: "echo should-not-run" })).rejects.toThrow(/cancel|abort/i)
    expect(await test.jobs.attach("aborted-attempt", test.root)).toBeNull()
    await expect(readFile(join(test.root, "aborted-attempt", "output.log"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("does not turn an unsuccessful shell command into a confirmed operation", async () => {
    const jobs = createSandboxJobs({ process: { executeCommand: async () => ({ exitCode: 1, result: "" }) } } as unknown as Sandbox)
    await expect(jobs.start({ jobId: "failed-write", command: "true" })).rejects.toThrow(/start sandbox job.*exit code 1.*without a diagnostic/i)
    await expect(jobs.abort("failed-write")).rejects.toThrow()
    await expect(jobs.attach("failed-write")).rejects.toThrow()
  })

  it("reports the sandbox command output unchanged", async () => {
    const output = "/usr/bin/bash: line 1: /usr/bin/sh: Argument list too long"
    const jobs = createSandboxJobs({ process: { executeCommand: async () => ({ exitCode: 126, result: `${output}\n` }) } } as unknown as Sandbox)
    await expect(jobs.start({ command: "true", env: { PORT: "3000" } })).rejects.toThrow(
      new Error(`Could not start sandbox job (exit code 126): ${output}`),
    )
  })

  it("passes env in the request's env field, never in the command text", async () => {
    const test = await localSandbox()
    const secret = "test-credential-value"
    const handle = await test.jobs.start({ jobId: "env-field", root: test.root, command: "printf %s \"$API_TOKEN\"", env: { API_TOKEN: secret } })
    test.handles.push(handle)
    for (let i = 0; i < 40 && await readFile(handle.outputFile, "utf8") !== secret; i++) await new Promise((r) => setTimeout(r, 50))
    expect(await readFile(handle.outputFile, "utf8")).toBe(secret)
    expect(test.commands.some((command) => command.includes(secret))).toBe(false)
  })

  it("returns the detached launcher's diagnostic when it fails before publishing metadata", async () => {
    const reason = "mkdir: cannot create cgroup: Read-only file system"
    const test = await localSandbox(reason)
    const jobId = "bootstrap-failure"
    const startedAt = Date.now()
    await expect(test.jobs.start({ jobId, root: test.root, command: "echo should-not-run" })).rejects.toThrow(reason)
    // The launcher has exited with an error, so the wait stops early rather
    // than polling for a record it can no longer write (~5s).
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(await test.jobs.attach(jobId, test.root)).toBeNull()
  })

  it("serializes concurrent starts and cancellation without a late second launch", async () => {
    const test = await localSandbox()
    for (let round = 0; round < 4; round++) {
      const id = `race-${round}`
      const options = { jobId: id, root: test.root, command: "echo started; sleep 10" }
      const results = await Promise.allSettled([
        test.jobs.start(options), createSandboxJobs(test.sandbox).start(options),
        test.jobs.abort(id, test.root),
      ])
      for (const result of results.slice(0, 2)) {
        if (result.status === "fulfilled") test.handles.push(result.value as { pgid: number })
      }
      expect(results[2].status).toBe("fulfilled")
      await expect(test.jobs.start(options)).rejects.toThrow(/cancel/i)
      const handle = await test.jobs.attach(id, test.root)
      if (handle) {
        test.handles.push(handle)
        expect((await test.jobs.status(handle)).alive).toBe(false)
        const output = await readFile(handle.outputFile, "utf8").catch(() => "")
        expect(output.split("started").length - 1).toBeLessThanOrEqual(1)
      }
    }
  })

  it("does not execute user code when its durable process metadata cannot be written", async () => {
    const test = await localSandbox()
    // A directory at the atomic rename destination forces the wrapper's
    // metadata operation to fail. No command may run without a readable file.
    await mkdir(join(test.root, "metadata-failure", "meta.json"), { recursive: true })
    await expect(test.jobs.start({ jobId: "metadata-failure", root: test.root, command: "echo forbidden" })).rejects.toThrow()
    await expect(readFile(join(test.root, "metadata-failure", "output.log"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("does not treat corrupt existing metadata as proof that a job never started", async () => {
    const test = await localSandbox()
    const handle = await test.jobs.start({ jobId: "corrupt-metadata", root: test.root, command: "echo started; sleep 10" })
    test.handles.push(handle)
    await writeFile(join(handle.dir, "meta.json"), "")
    await expect(test.jobs.attach(handle.jobId, test.root)).rejects.toThrow(/metadata/)
    await expect(test.jobs.abort(handle.jobId, test.root)).rejects.toThrow(/metadata/)
    expect((await test.jobs.status(handle)).alive).toBe(true)
  })

  it("rejects missing acknowledgements for reads and aborts", async () => {
    const jobs = createSandboxJobs({ process: { executeCommand: async () => ({ exitCode: 0, result: "" }) } } as unknown as Sandbox)
    await expect(jobs.attach("unknown")).rejects.toThrow(/incomplete/)
    await expect(jobs.abort("unknown")).rejects.toThrow(/incomplete/)
    await expect(jobs.isAborted("unknown")).rejects.toThrow(/unknown/)
  })
})
