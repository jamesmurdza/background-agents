import { describe, expect, it } from "vitest"
import { codexAgent } from "../src/agents/codex"
import { claudeAgent } from "../src/agents/claude"
import { opencodeAgent } from "../src/agents/opencode"
import { getThinkingCapability, validateThinking } from "../src/thinking"
import { getRuntimeThinkingCapability, readOpenCodeVariants, verifyThinkingRuntime } from "../src/thinking-runtime"
import type { CodeAgentSandbox } from "../src/types/provider"

describe("per-turn thinking controls", () => {
  it("gates Kimi invocation overrides on the tested native runtime", async () => {
    for (const output of ["2.1.0", "unknown version"]) {
      const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
      expect((await getRuntimeThinkingCapability("kimi", "kimi-k2.5", sandbox)).levels).toEqual([])
      await expect(verifyThinkingRuntime("kimi", { model: "kimi-k2.5", thinking: "on" }, sandbox)).rejects.toThrow()
    }
    const sandbox = { executeCommand: async (command: string) => {
      expect(command).toContain('.kimi-code/bin')
      return { exitCode: 0, output: "2.1.1" }
    } } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("kimi", "kimi-k2.5", sandbox)).levels).toEqual(["on", "off"])
    await expect(verifyThinkingRuntime("kimi", { model: "kimi-k2.5", thinking: "on" }, sandbox)).resolves.toBeUndefined()
    await expect(verifyThinkingRuntime("kimi", { model: "kimi-k2.5", thinking: "on", env: { KIMI_BASE_URL: "https://example.test" } }, sandbox)).rejects.toThrow("custom endpoint")
  })
  it("passes Codex effort as an invocation override", () => {
    const spec = codexAgent.buildCommand({ model: "gpt-6.1-sol", prompt: "hello", thinking: "low" })
    expect(spec.args).toContain('model_reasoning_effort="low"')
  })
  it("passes Claude effort separately from plan permissions", () => {
    const spec = claudeAgent.buildCommand({ model: "sonnet", prompt: "hello", planMode: true, thinking: "high" })
    expect(spec.args).toContain("--effort")
    expect(spec.args).toContain("high")
    expect(spec.args).toContain("plan")
  })
  it("leaves OpenCode's default to the runtime instead of forcing medium", () => {
    expect(opencodeAgent.buildCommand({ model: "opencode/big-pickle", prompt: "hello" }).args.join(" ")).not.toContain("--variant")
  })
  it.each([undefined, null, "default"])("accepts legacy/default values %s without inventing a level", thinking => {
    expect(validateThinking("eliza", "eliza-classic-1.0", thinking)).toBe("default")
  })
  it.each([false, 1, {}, "extreme", "high; rm file"])("rejects invalid or unverified levels %s", thinking => {
    expect(() => validateThinking("codex", "gpt-6.1-sol", thinking)).toThrow("Choose Default")
  })
  it("exposes the verified top level only on models that support it", () => {
    expect(validateThinking("codex", "gpt-6.1-sol", "ultra")).toBe("ultra")
    expect(() => validateThinking("codex", "gpt-6-luna", "ultra")).toThrow("Choose Default")
  })
  it.each(["eliza", "gemini", "goose", "unknown"])("does not silently ignore unsupported agent %s", agent => {
    expect(() => validateThinking(agent, "some-model", "high")).toThrow("not supported")
  })
  it("does not infer provider support from an endpoint's model name", () => {
    expect(getThinkingCapability("codex", "endpoint:test").levels).toEqual([])
    expect(() => validateThinking("opencode", "custom/gpt-6.1-sol", "high")).toThrow()
    expect(() => validateThinking("claude", "claude-haiku-4-5", "high")).toThrow()
  })
  it("keeps permissions, prompt, and resume separate from effort", () => {
    for (const thinking of ["low", "high", "default"] as const) {
      const spec = codexAgent.buildCommand({ model: "gpt-6.1-sol", prompt: "--effort malicious", sessionId: "old-session", planMode: true, thinking })
      expect(spec.args.slice(-4)).toEqual(["resume", "old-session", "--", "--effort malicious"])
      expect(spec.args).toContain("read-only")
      expect(spec.args.join(" ").includes("model_reasoning_effort=")).toBe(thinking !== "default")
    }
  })
  it("does not leak one command's effort into another invocation", () => {
    const high = claudeAgent.buildCommand({ model: "sonnet", thinking: "high" })
    const low = claudeAgent.buildCommand({ model: "sonnet", thinking: "low" })
    const normal = claudeAgent.buildCommand({ model: "sonnet", thinking: "default" })
    expect(high.args.slice(0, 2)).toEqual(["--effort", "high"])
    expect(low.args.slice(0, 2)).toEqual(["--effort", "low"])
    expect(normal.args).not.toContain("--effort")
  })
  it("checks installed OpenCode variants rather than trusting only UI capabilities", async () => {
    const output = 'opencode/big-pickle\n{\n  "variants": {"low": {}, "high": {"disabled": true}}\n}\n'
    expect(readOpenCodeVariants(output, "opencode/big-pickle")).toEqual(["low"])
    const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
    await expect(verifyThinkingRuntime("opencode", { model: "opencode/big-pickle", thinking: "high" }, sandbox)).rejects.toThrow("installed OpenCode")
    await expect(verifyThinkingRuntime("opencode", { model: "opencode/big-pickle", thinking: "low" }, sandbox)).resolves.toBeUndefined()
  })
  it("rejects old/unknown runtime versions without running an agent", async () => {
    for (const output of ["codex-cli 0.157.1", "not installed"]) {
      const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
      expect((await getRuntimeThinkingCapability("codex", "gpt-6.1-sol", sandbox)).status).toBe(output.includes("0.157.1") ? "unverified" : "check_failed")
      await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "low" }, sandbox)).rejects.toThrow("Default")
      await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "default" }, sandbox)).resolves.toBeUndefined()
    }
  })
  it("does not invent levels when native discovery is empty, malformed, or unavailable", async () => {
    for (const output of ['opencode/big-pickle\n{\n "variants": {}\n}\n', 'invalid json', 'opencode/other\n{\n "variants": {"low":{}}\n}\n']) {
      const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
      expect((await getRuntimeThinkingCapability("opencode", "opencode/big-pickle", sandbox)).levels).toEqual([])
      await expect(verifyThinkingRuntime("opencode", { model: "opencode/big-pickle", thinking: "low" }, sandbox)).rejects.toThrow("Default")
    }
    const sandbox = { executeCommand: async () => { throw new Error("timeout") } } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("opencode", "opencode/big-pickle", sandbox)).reason).toContain("try again")
  })
  it("scopes endpoint checks to the selected agent and makes discovery failures actionable", async () => {
    const sandbox = { executeCommand: async () => ({ exitCode: 0, output: "codex-cli 0.159.3" }) } as unknown as CodeAgentSandbox
    await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "low", env: { ANTHROPIC_BASE_URL: "https://example.test" } }, sandbox)).resolves.toBeUndefined()
    await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "low", env: { OPENAI_BASE_URL: "https://example.test" } }, sandbox)).rejects.toThrow("custom endpoint")
    await expect(verifyThinkingRuntime("claude", { model: "sonnet", thinking: "high", env: { CLAUDE_CODE_USE_BEDROCK: "1" } }, sandbox)).rejects.toThrow("custom endpoint")
    const offline = { executeCommand: async () => { throw new Error("transport unavailable") } } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("codex", "gpt-6.1-sol", offline)).status).toBe("check_failed")
    await expect(verifyThinkingRuntime("codex", { model: "gpt-6.1-sol", thinking: "low" }, offline)).rejects.toThrow("sandbox reconnects")
  })
  it("keeps Pi's registry authoritative and rejects unsupported levels instead of clamping", async () => {
    for (const output of ['[]', '{"high":true}', 'not JSON']) {
      const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
      expect((await getRuntimeThinkingCapability("pi", "openai/gpt-6.1-sol", sandbox)).levels).toEqual([])
      await expect(verifyThinkingRuntime("pi", { model: "openai/gpt-6.1-sol", thinking: "high" }, sandbox)).rejects.toThrow("Default")
    }
    const sandbox = { executeCommand: async () => ({ exitCode: 0, output: '["off","low","high","future","default"]' }) } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("pi", "openai/gpt-6.1-sol", sandbox)).levels).toEqual(["off", "low", "high"])
    await expect(verifyThinkingRuntime("pi", { model: "openai/gpt-6.1-sol", thinking: "medium" }, sandbox)).rejects.toThrow()
  })
  it("offers only safe, enabled variants from the exact Kilo model", async () => {
    const output = 'kilo/example/model\n{\n "variants": {"low":{}, "deep-review":{}, "disabled":{"disabled":true}, "bad;cmd":{}, "default":{}}\n}\n'
    const sandbox = { executeCommand: async () => ({ exitCode: 0, output }) } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("kilo", "kilo/example/model", sandbox)).levels).toEqual(["low", "variant:deep-review"])
    await expect(verifyThinkingRuntime("kilo", { model: "kilo/example/model", thinking: "variant:deep-review" }, sandbox)).resolves.toBeUndefined()
    await expect(verifyThinkingRuntime("kilo", { model: "kilo/example/model", thinking: "variant:disabled" }, sandbox)).rejects.toThrow()
  })
  it("does not offer budgets on an unverified Gemini runtime or custom endpoint", async () => {
    const old = { executeCommand: async () => ({ exitCode: 0, output: "0.60.0" }) } as unknown as CodeAgentSandbox
    expect((await getRuntimeThinkingCapability("gemini", "gemini-2.5-flash", old)).budget).toBeUndefined()
    await expect(verifyThinkingRuntime("gemini", { model: "gemini-2.5-flash", thinking: "budget:1024" }, old)).rejects.toThrow()
    const current = { executeCommand: async () => ({ exitCode: 0, output: "0.61.0" }) } as unknown as CodeAgentSandbox
    await expect(verifyThinkingRuntime("gemini", { model: "gemini-2.5-flash", thinking: "budget:1024" }, current)).resolves.toBeUndefined()
    await expect(verifyThinkingRuntime("gemini", { model: "gemini-2.5-flash", thinking: "budget:1024", env: { GOOGLE_GEMINI_BASE_URL: "https://example.test" } }, current)).rejects.toThrow("custom endpoint")
  })
})
