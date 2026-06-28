/**
 * Claude agent buildCommand tests.
 *
 * Covers argument construction, with particular focus on the `--` end-of-options
 * sentinel that prevents prompts starting with `-` from being parsed as flags
 * by the Claude CLI.
 */
import { describe, it, expect } from "vitest"
import { claudeAgent } from "../src/agents/index.js"

describe("claudeAgent.buildCommand", () => {
  it("uses 'claude' as the command", () => {
    const { cmd } = claudeAgent.buildCommand({ prompt: "hello" })
    expect(cmd).toBe("claude")
  })

  it("always includes -p, --output-format, stream-json, --verbose, and --dangerously-skip-permissions", () => {
    const { args } = claudeAgent.buildCommand({ prompt: "hello" })
    expect(args).toContain("-p")
    expect(args).toContain("--output-format")
    expect(args).toContain("stream-json")
    expect(args).toContain("--verbose")
    expect(args).toContain("--dangerously-skip-permissions")
  })

  it("places -- immediately before the prompt", () => {
    const { args } = claudeAgent.buildCommand({ prompt: "hello" })
    const sepIdx = args.indexOf("--")
    expect(sepIdx).toBeGreaterThanOrEqual(0)
    expect(args[sepIdx + 1]).toBe("hello")
  })

  it("does not append -- or the prompt when prompt is omitted", () => {
    const { args } = claudeAgent.buildCommand({})
    expect(args).not.toContain("--")
  })

  // Prompts starting with `-` must land after the `--` sentinel, otherwise the
  // Claude CLI's own argument parser treats them as flags and crashes with
  // "error: unknown option '-hi'".
  it.each(["- hi", "-hi", "-"])(
    "places a dash-prefixed prompt %j after the -- sentinel (not treated as a flag)",
    (prompt) => {
      const { args } = claudeAgent.buildCommand({ prompt })
      const sepIdx = args.indexOf("--")
      expect(sepIdx).toBeGreaterThanOrEqual(0)
      expect(args[sepIdx + 1]).toBe(prompt)
    }
  )

  it("includes --system-prompt when systemPrompt is provided", () => {
    const { args } = claudeAgent.buildCommand({
      prompt: "hello",
      systemPrompt: "You are helpful.",
    })
    const spIdx = args.indexOf("--system-prompt")
    expect(spIdx).toBeGreaterThanOrEqual(0)
    expect(args[spIdx + 1]).toBe("You are helpful.")
  })

  it("includes --model when model is provided", () => {
    const { args } = claudeAgent.buildCommand({ prompt: "hello", model: "opus" })
    const mIdx = args.indexOf("--model")
    expect(mIdx).toBeGreaterThanOrEqual(0)
    expect(args[mIdx + 1]).toBe("opus")
  })

  it("includes --resume when sessionId is provided", () => {
    const { args } = claudeAgent.buildCommand({ prompt: "hi", sessionId: "abc123" })
    const rIdx = args.indexOf("--resume")
    expect(rIdx).toBeGreaterThanOrEqual(0)
    expect(args[rIdx + 1]).toBe("abc123")
  })

  it("sets CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 by default", () => {
    const { env } = claudeAgent.buildCommand({ prompt: "hello" })
    expect(env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1")
  })

  it("merges caller-provided env with the background-task default", () => {
    const { env } = claudeAgent.buildCommand({ prompt: "hello", env: { FOO: "bar" } })
    expect(env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1")
    expect(env?.FOO).toBe("bar")
  })

  it("lets a caller override CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", () => {
    const { env } = claudeAgent.buildCommand({
      prompt: "hello",
      env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0" },
    })
    expect(env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("0")
  })

  it("-- comes after all other flags", () => {
    const { args } = claudeAgent.buildCommand({
      prompt: "hello",
      systemPrompt: "sys",
      model: "sonnet",
      sessionId: "s1",
    })
    const sepIdx = args.indexOf("--")
    // Every flag index should be before the separator
    for (const flag of ["-p", "--output-format", "--verbose", "--dangerously-skip-permissions", "--system-prompt", "--model", "--resume"]) {
      const idx = args.indexOf(flag)
      expect(idx).toBeLessThan(sepIdx)
    }
  })
})
