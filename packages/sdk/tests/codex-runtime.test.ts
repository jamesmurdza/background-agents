import { describe, expect, it, vi } from "vitest"
import { adaptDaytonaSandbox } from "../src/sandbox/daytona"
import type { Sandbox } from "@daytonaio/sdk"
import { CODEX_CLI_VERSION } from "../src/utils/install"
import { CODEX_RUNTIME_PREFIX, isSupportedCodexVersion } from "../src/utils/codex-runtime"
import { CODEX_CLI_VERSION as IMAGE_CODEX_VERSION, CODEX_INSTALL_COMMAND } from "../../sandbox-image/src/image"
import { getSession } from "../src/session"
import type { CodeAgentSandbox } from "../src/types/provider"

const jobStart = vi.hoisted(() => vi.fn(async () => ({ id: "qa-job" })))
vi.mock("@background-agents/sandbox-jobs", () => ({ createSandboxJobs: () => ({ start: jobStart }) }))

describe("Codex runtime preparation", () => {
  it("accepts only the exact reviewed release", () => {
    expect(isSupportedCodexVersion(`codex-cli ${CODEX_CLI_VERSION}\n`)).toBe(true)
  })
  it.each(["codex-cli 0.157.1", "codex-cli 0.159.2", "codex-cli 0.160.0", "codex-cli 1.0.0", "codex-cli 0.159.3-alpha.1", "garbage", ""])("rejects old or unreviewed version %j", version => {
    expect(isSupportedCodexVersion(version)).toBe(false)
  })
  it.each(["0.157.1", CODEX_CLI_VERSION, "0.160.0", "missing"])("selects its immutable runtime regardless of global CLI %s", async globalVersion => {
    const executeCommand = vi.fn(async (command: string, _cwd?: string, _env?: Record<string, string>) => {
      if (command === "codex --version") return { exitCode: 0, result: `codex-cli ${globalVersion}` }
      if (command === `${CODEX_RUNTIME_PREFIX}/bin/codex --version`) return { exitCode: 0, result: `codex-cli ${CODEX_CLI_VERSION}` }
      if (command.startsWith("printf")) return { exitCode: 0, result: "/usr/local/bin:/usr/bin:/bin" }
      return { exitCode: 0, result: "" }
    })
    const sandbox = adaptDaytonaSandbox({ process: { executeCommand } } as unknown as Sandbox)
    await sandbox.ensureProvider("codex")
    const preparation = executeCommand.mock.calls.map(([cmd]) => cmd)
    sandbox.setSessionEnvVars!({ PATH: "/custom/bin:/usr/bin:/bin" })
    sandbox.setRunEnvVars!({ PATH: "/run/bin:/usr/bin:/bin", QA_RUN: "kept" })
    await sandbox.executeCommand!("codex --version")
    // Env travels in the request's env field; the command text stays as given.
    const [command, , env] = executeCommand.mock.calls.at(-1)!
    expect(command).toBe("codex --version")
    expect(env).toMatchObject({ PATH: `${CODEX_RUNTIME_PREFIX}/bin:/run/bin:/usr/bin:/bin`, QA_RUN: "kept" })
    sandbox.clearRunEnvVars!()
    await sandbox.executeCommand!("codex --version")
    expect(executeCommand.mock.calls.at(-1)![2]).toEqual({ PATH: `${CODEX_RUNTIME_PREFIX}/bin:/custom/bin:/usr/bin:/bin` })
    await sandbox.jobs!.start({ command: "codex --version", env: { PATH: "/job/bin:/usr/bin:/bin" } })
    expect(jobStart.mock.calls.at(-1)?.[0]).toMatchObject({ env: {
      PATH: `${CODEX_RUNTIME_PREFIX}/bin:/job/bin:/usr/bin:/bin`,
    } })
    const install = executeCommand.mock.calls[0][0]
    expect(install).toContain("flock -w 120")
    expect(install).toContain("mktemp -d")
    expect(install).not.toContain("auth.json")
    expect(install).not.toContain("sudo")
    // Preparation never consults a global `codex` on PATH.
    expect(preparation).not.toContain("codex --version")
  })
  it("does not disclose installer output on failure", async () => {
    const executeCommand = vi.fn(async (command: string) => command === "codex --version"
      ? { exitCode: 127, result: "" } : { exitCode: 1, result: "registry password=secret" })
    const sandbox = adaptDaytonaSandbox({ process: { executeCommand } } as unknown as Sandbox)
    await expect(sandbox.ensureProvider("codex")).rejects.toThrow("Codex CLI update failed")
    await expect(sandbox.ensureProvider("codex")).rejects.not.toThrow("secret")
  })
  it("pins the image to the same tested package as runtime preparation", () => {
    expect(IMAGE_CODEX_VERSION).toBe(CODEX_CLI_VERSION)
    expect(CODEX_INSTALL_COMMAND).toContain(`--prefix ${CODEX_RUNTIME_PREFIX} @openai/codex@${CODEX_CLI_VERSION}`)
    expect(CODEX_INSTALL_COMMAND).toContain(`codex-cli ${CODEX_CLI_VERSION}`)
  })
  it("can reattach to Codex without an installer or registry", async () => {
    const ensureProvider = vi.fn(async () => { throw new Error("registry offline") })
    const executeCommand = vi.fn(async (command: string) => ({ exitCode: 0, output: command.includes("meta.json")
      ? JSON.stringify({ provider: "codex", sessionId: "thread-test", currentTurn: 1 }) : "" }))
    const sandbox = { ensureProvider, executeCommand, setEnvVars: vi.fn() } as CodeAgentSandbox
    const session = await getSession("test-run", { sandbox })
    expect(ensureProvider).not.toHaveBeenCalled()
    await expect(session.start("Start a new turn")).rejects.toThrow("registry offline")
    expect(ensureProvider).toHaveBeenCalledTimes(1)
  })
  it("does not accept an installed but outdated CLI", async () => {
    const executeCommand = vi.fn(async (command: string) => {
      if (command.includes("--version")) return { exitCode: 0, result: "codex-cli 0.157.1" }
      return { exitCode: 0, result: "/usr/local/bin/codex" }
    })
    const sandbox = adaptDaytonaSandbox({ process: { executeCommand } } as unknown as Sandbox)
    await expect(sandbox.ensureProvider("codex")).rejects.toThrow(/Codex/)
    expect(executeCommand.mock.calls.some(([command]) => command.includes("--version"))).toBe(true)
  })
  it.each(["", "bad\npath"])("fails closed for an invalid runtime PATH %j", async path => {
    const executeCommand = vi.fn(async (command: string) => ({ exitCode: 0, result:
      command.startsWith("printf") ? path : command.endsWith("--version") ? `codex-cli ${CODEX_CLI_VERSION}` : "" }))
    await expect(adaptDaytonaSandbox({ process: { executeCommand } } as unknown as Sandbox).ensureProvider("codex"))
      .rejects.toThrow("runtime path could not be prepared")
  })
  it("does not expose registry details when the transport throws", async () => {
    const executeCommand = vi.fn(async () => { throw new Error("registry https://user:secret@example.test timed out") })
    await expect(adaptDaytonaSandbox({ process: { executeCommand } } as unknown as Sandbox).ensureProvider("codex"))
      .rejects.toThrow("Codex CLI update failed")
  })
})
