import { describe, expect, it } from "vitest"
import { commandCodeAgent } from "../src/agents/commandcode"
import { copilotAgent } from "../src/agents/copilot"
import { droidAgent } from "../src/agents/droid"
import { kiloAgent } from "../src/agents/kilo"
import { piAgent } from "../src/agents/pi"
import { geminiAgent } from "../src/agents/gemini"
import { kimiAgent } from "../src/agents/kimi"
import { getThinkingCapability, validateThinking } from "../src/thinking"

describe("native thinking across adapters", () => {
  it.each([
    ["kimi-k2.6", ["on", "off"]],
  ] as const)("preserves %s per-prompt settings without carrying an override into Default", (model, levels) => {
    expect(getThinkingCapability("kimi", model).levels).toEqual(levels)
    for (const thinking of [...levels, "default"]) {
      const spec = kimiAgent.buildCommand({ model, thinking, sessionId: "existing-session", prompt: "continue" })
      expect(spec.env?.KIMI_MODEL_THINKING_EFFORT).toBe(thinking === "default" ? undefined : thinking)
      expect(spec.args.join(" ")).toContain("existing-session")
    }
  })
  it("keeps Kimi on/off process-local and restores the native default on resume", () => {
    const options = { model: "kimi-k2.5", prompt: "quoted ' prompt", sessionId: "session-A", env: { KIMI_API_KEY: "fixture" } }
    for (const thinking of ["on", "off", "default", "on", "default"]) {
      const spec = kimiAgent.buildCommand({ ...options, thinking })
      expect(spec.env?.KIMI_MODEL_THINKING_EFFORT).toBe(thinking === "default" ? undefined : thinking)
      expect(spec.env?.KIMI_API_KEY).toBe("fixture")
      expect(spec.args.join(" ")).toContain("session-A")
      expect(spec.args.join(" ")).not.toContain("config.toml")
    }
    expect(options.env).toEqual({ KIMI_API_KEY: "fixture" })
    for (const model of ["kimi-k3", "kimi-k2.7-code", "endpoint:custom"]) {
      expect(() => kimiAgent.buildCommand({ model, thinking: "off" })).toThrow("not supported")
    }
    expect(() => kimiAgent.buildCommand({ model: "kimi-k2.5", thinking: "high" })).toThrow("not supported")
    // K3's public API supports effort, but this CLI's kimi provider emits
    // thinking.effort, not the required top-level reasoning_effort.
    expect(() => kimiAgent.buildCommand({ model: "kimi-k3", thinking: "low" })).toThrow("not supported")
  })
  it.each([
    [commandCodeAgent, "claude-sonnet-5-5", "--effort"],
    [copilotAgent, "gpt-6.1-sol", "--reasoning-effort"],
    [droidAgent, "factory/gpt-6.1-sol", "--reasoning-effort"],
    [kiloAgent, "kilo/openai/gpt-6.1-sol", "--variant"],
    [piAgent, "openai/gpt-6.1-sol", "--thinking"],
  ] as const)("%s forwards the native choice without changing the prompt", (agent, model, flag) => {
    const options = { model, prompt: "unique prompt", thinking: "high" as const, sessionId: "session-481" }
    const explicit = agent.buildCommand(options)
    expect(explicit.args.join(" ")).toContain(flag)
    expect(explicit.args.join(" ")).toContain("high")
    expect(explicit.args.join(" ")).toContain("unique prompt")
    const normal = agent.buildCommand({ ...options, thinking: "default" })
    expect(normal.args.join(" ")).not.toContain(flag)
  })
  it("does not apply Factory controls to BYOK models", () => {
    expect(getThinkingCapability("droid", "gpt-6.1-sol").levels).toEqual([])
    expect(() => droidAgent.buildCommand({ model: "gpt-6.1-sol", thinking: "high" })).toThrow("not supported")
  })
  it("validates Gemini token budgets separately from effort labels", () => {
    expect(validateThinking("gemini", "gemini-2.5-flash", "budget:1024")).toBe("budget:1024")
    for (const value of ["high", "budget:-2", "budget:24577", "budget:1.5", "budget:01"]) {
      expect(() => validateThinking("gemini", "gemini-2.5-flash", value)).toThrow()
    }
    expect(() => validateThinking("gemini", "gemini-3.8-flash", "budget:1024")).toThrow()
  })
  it("isolates Gemini overrides instead of editing shared user settings", () => {
    const spec = geminiAgent.buildCommand({ model: "gemini-3.8-flash", thinking: "high", prompt: "hi" })
    expect(spec.cmd).toBe("node")
    expect(spec.args.join(" ")).toContain("GEMINI_CLI_HOME")
    expect(spec.args.join(" ")).toContain("thinkingLevel")
    expect(geminiAgent.buildCommand({ model: "gemini-3.8-flash", thinking: "default" }).cmd).toBe("gemini")
  })
  it("keeps dynamic variant names distinct from native level names", () => {
    expect(validateThinking("kilo", "kilo/openai/gpt-6.1-sol", "variant:deep-review")).toBe("variant:deep-review")
    expect(() => validateThinking("kilo", "kilo/openai/gpt-6.1-sol", "variant:x; echo bad")).toThrow()
    expect(() => validateThinking("codex", "gpt-6.1-sol", "variant:deep-review")).toThrow()
  })
})
