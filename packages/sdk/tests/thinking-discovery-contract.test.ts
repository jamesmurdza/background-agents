import { describe, expect, it, vi } from "vitest"
import { getRuntimeThinkingCapability, verifyThinkingRuntime } from "../src/thinking-runtime"
import { getVerifiedThinkingCapability, validateThinking, THINKING_CLI_TIMEOUT_SECONDS, THINKING_SERVER_TIMEOUT_MS, THINKING_BROWSER_TIMEOUT_MS } from "../src/thinking"
import type { CodeAgentSandbox } from "../src/types/provider"
import { adaptDaytonaSandbox } from "../src/sandbox/daytona"

function sandbox(output: string, exitCode = 0): CodeAgentSandbox {
  return { ensureProvider: async () => {}, setEnvVars: () => {}, executeCommand: async () => ({ output, exitCode }) }
}
const entry = (model: string, variants: Record<string, unknown>) => `${model}\n${JSON.stringify({ variants }, null, 2)}\n`

describe("thinking discovery result contract", () => {
  it.each([
    ["command unavailable", "command not found", 127, "runtime_unavailable"],
    ["command failure", "transport rejected", 1, "check_failed"],
    ["malformed catalog", "not JSON", 0, "check_failed"],
    ["model absent", entry("opencode/another-model", {}), 0, "unverified"],
    ["valid empty variants", entry("opencode/big-pickle", {}), 0, "no_controls"],
    ["available variants", entry("opencode/big-pickle", { low: {}, high: {} }), 0, "available"],
  ])("distinguishes %s", async (_label, output, exitCode, status) => {
    const result = await getRuntimeThinkingCapability("opencode", "opencode/big-pickle", sandbox(String(output), Number(exitCode)))
    expect(result).toHaveProperty("status", status)
  })

  it("keeps valid native variants even if another name is unsafe", async () => {
    const runtime = sandbox(entry("kilo/example/model", { low: {}, ultra: {}, on: {}, "unsafe name": {}, malformed: null, high: { disabled: true } }))
    const capability = await getRuntimeThinkingCapability("kilo", "kilo/example/model", runtime)
    expect(capability.levels).toEqual(["low", "ultra", "on"])
    for (const level of capability.levels) {
      expect(() => validateThinking("kilo", "kilo/example/model", level)).not.toThrow()
      await expect(verifyThinkingRuntime("kilo", { model: "kilo/example/model", thinking: level }, runtime)).resolves.toBeUndefined()
    }
  })

  it("checks the launch working directory and environment without mutating sandbox state", async () => {
    const commands: string[] = []
    const runtime = sandbox(entry("opencode/model", { high: {} }))
    runtime.executeCommand = async command => { commands.push(command); return { exitCode: 0, output: entry("opencode/model", { high: {} }) } }
    runtime.setEnvVars = () => { throw new Error("shared environment mutated") }
    await verifyThinkingRuntime("opencode", { model: "opencode/model", thinking: "high", cwd: "/workspace/a ' b", env: { OPENCODE_CONFIG: "/tmp/qa config.json" } }, runtime)
    expect(commands.join("\n")).toContain("/workspace/a")
    expect(commands.join("\n")).toContain("OPENCODE_CONFIG")
    expect(commands.join("\n")).toContain("qa config.json")
  })

  it("does not classify malformed variant objects or model JSON as verified empty", async () => {
    for (const output of [entry("opencode/model", { low: null }), 'opencode/model\n{broken\n}\n', `opencode/model\n{broken\n${entry("opencode/other", {})}`]) {
      expect((await getRuntimeThinkingCapability("opencode", "opencode/model", sandbox(output))).status).toBe("check_failed")
    }
  })

  it.each([
    ["missing variants", { name: "model" }, "unverified"],
    ["disabled and malformed siblings", { variants: { low: { disabled: true }, high: null } }, "check_failed"],
    ["only disabled variants", { variants: { high: { disabled: true } } }, "no_controls"],
    ["valid empty variants", { variants: {} }, "no_controls"],
  ])("distinguishes %s from verified absent controls", async (_label, metadata, status) => {
    const output = `opencode/model\n${JSON.stringify(metadata, null, 2)}\n`
    const result = await getRuntimeThinkingCapability("opencode", "opencode/model", sandbox(output))
    expect(result.status).toBe(status)
  })

  it.each([
    ["valid with malformed sibling", ["high", null], "available", ["high"]],
    ["valid with unknown sibling", ["high", "future-level"], "available", ["high"]],
    ["unrecognized controls", ["future-level"], "unverified", []],
    ["malformed controls", [null], "check_failed", []],
    ["valid empty controls", [], "no_controls", []],
  ])("preserves Pi discovery meaning for %s", async (_label, levels, status, offered) => {
    const runtime = sandbox(JSON.stringify({ found: true, levels }))
    const result = await getRuntimeThinkingCapability("pi", "openai/gpt-6.1-sol", runtime)
    expect(result.status).toBe(status)
    expect(result.levels).toEqual(offered)
    if (status === "available") await expect(verifyThinkingRuntime("pi", { model: "openai/gpt-6.1-sol", thinking: "high" }, runtime)).resolves.toBeUndefined()
  })

  it.each(["initial", "session", "run"])("checks custom routing inherited from the adapter's %s environment", async (source) => {
    const executeCommand = vi.fn(async () => ({ exitCode: 0, result: "codex-cli 0.159.3" }))
    const native = { process: { executeCommand } } as unknown as Parameters<typeof adaptDaytonaSandbox>[0]
    const custom = { OPENAI_BASE_URL: "https://qa.invalid/v1" }
    const runtime = adaptDaytonaSandbox(native, source === "initial" ? { env: custom } : undefined)
    if (source === "session") runtime.setSessionEnvVars!(custom)
    if (source === "run") runtime.setRunEnvVars!(custom)
    expect((await getRuntimeThinkingCapability("codex", "gpt-6.1-sol", runtime)).status).toBe("unverified")
    await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "high" }, runtime)).rejects.toThrow("custom endpoint")
    expect(executeCommand).not.toHaveBeenCalled()

    // An explicit invocation override wins without mutating inherited state.
    await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "high", env: { OPENAI_BASE_URL: "" } }, runtime)).resolves.toBeUndefined()
    expect((await getRuntimeThinkingCapability("codex", "gpt-6.1-sol", runtime)).status).toBe("unverified")
    if (source === "run") {
      runtime.clearRunEnvVars!()
      expect((await getRuntimeThinkingCapability("codex", "gpt-6.1-sol", runtime)).status).toBe("available")
    }
  })

  it("keeps a trusted first-prompt catalog separate from unknown versions, endpoints and provider access", () => {
    const sol = getVerifiedThinkingCapability("codex", "gpt-6.1-sol")
    expect(sol.levels).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"])
    expect(sol.provenance?.source).toBe("verified_catalog")
    expect(sol.provenance?.evidence).toContain("not current account entitlement")
    expect(getVerifiedThinkingCapability("codex", "gpt-6-luna").levels).not.toContain("ultra")
    expect(getVerifiedThinkingCapability("opencode", "opencode/longcat-2.5-preview-free").levels).toEqual(["low", "medium", "high"])
    expect(getVerifiedThinkingCapability("opencode", "opencode/big-pickle").status).toBe("no_controls")
    expect(getVerifiedThinkingCapability("opencode", "opencode/unknown").status).toBe("unverified")
    expect(getVerifiedThinkingCapability("codex", "gpt-6.1-sol", { runtimeVersion: "0.157.1" }).levels).toEqual([])
    expect(getVerifiedThinkingCapability("codex", "gpt-6.1-sol", { customEndpoint: true }).levels).toEqual([])
  })

  it("does not turn a minimum CLI version into model/account verification", async () => {
    const result = await getRuntimeThinkingCapability("commandcode", "gpt-6.1-sol", sandbox("1.82.3"))
    expect(result.status).toBe("available")
    expect(result.runtimeVersion).toBe("1.82.3")
    expect(result.provenance?.source).toBe("runtime_version")
    expect(result.provenance?.evidence).toContain("not a live model/account")
  })

  it("uses adapter contextual execution without mutating shared state", async () => {
    const context = { cwd: "/project/custom", env: { OPENCODE_CONFIG: "/tmp/variant.json" } }
    const runtime = sandbox("")
    runtime.executeCommand = async () => { throw new Error("context-free command used") }
    runtime.executeCommandInContext = async (_command, timeout, actual) => {
      expect(actual).toEqual(context)
      expect(timeout).toBe(THINKING_CLI_TIMEOUT_SECONDS)
      return { exitCode: 0, output: entry("opencode/model", { high: {} }) }
    }
    await expect(verifyThinkingRuntime("opencode", { model: "opencode/model", thinking: "high", ...context }, runtime)).resolves.toBeUndefined()
    expect(THINKING_CLI_TIMEOUT_SECONDS * 1000).toBeLessThan(THINKING_SERVER_TIMEOUT_MS)
    expect(THINKING_SERVER_TIMEOUT_MS).toBeLessThan(THINKING_BROWSER_TIMEOUT_MS)
  })

  it("does not claim default clears an inherited native setting or run discovery for default", async () => {
    const runtime = sandbox("")
    runtime.executeCommand = async () => { throw new Error("default must not probe") }
    await expect(verifyThinkingRuntime("kimi", { model: "kimi-k2.5", thinking: "default", env: { KIMI_MODEL_THINKING_EFFORT: "on" } }, runtime)).resolves.toBeUndefined()
  })
})
