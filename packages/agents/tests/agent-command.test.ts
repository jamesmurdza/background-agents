/**
 * buildCommand tests for every CLI agent.
 *
 * These lock the behaviour of the shared `buildAgentCommand` factory
 * (core/command.ts) that all agents delegate to. They focus on the per-agent
 * differences that the factory must preserve: subcommands, static flags, plan
 * mode, model/provider, resume style, prompt placement, and bash wrapping.
 */
import { describe, it, expect } from "vitest"
import {
  codexAgent,
  copilotAgent,
  geminiAgent,
  gooseAgent,
  kiloAgent,
  opencodeAgent,
  piAgent,
} from "../src/agents/index.js"

describe("codexAgent.buildCommand", () => {
  it("uses the exec subcommand with JSON streaming flags", () => {
    const { cmd, args } = codexAgent.buildCommand({ prompt: "hi" })
    expect(cmd).toBe("codex")
    expect(args.slice(0, 3)).toEqual(["exec", "--json", "--skip-git-repo-check"])
  })

  it("uses --yolo by default and --sandbox read-only in plan mode", () => {
    expect(codexAgent.buildCommand({ prompt: "p" }).args).toContain("--yolo")
    const plan = codexAgent.buildCommand({ prompt: "p", planMode: true }).args
    const idx = plan.indexOf("--sandbox")
    expect(plan[idx + 1]).toBe("read-only")
    expect(plan).not.toContain("--yolo")
  })

  it("resumes via the positional `resume <id>` form", () => {
    const { args } = codexAgent.buildCommand({ prompt: "p", sessionId: "s1" })
    const idx = args.indexOf("resume")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe("s1")
  })

  it("places the prompt after a -- sentinel", () => {
    const { args } = codexAgent.buildCommand({ prompt: "-flag-like" })
    const idx = args.indexOf("--")
    expect(args[idx + 1]).toBe("-flag-like")
  })
})

describe("copilotAgent.buildCommand", () => {
  it("places the prompt first, right after -p", () => {
    const { args } = copilotAgent.buildCommand({ prompt: "hello" })
    expect(args[0]).toBe("-p")
    expect(args[1]).toBe("hello")
    expect(args).toContain("--autopilot")
  })

  it("resumes with a valueless --continue", () => {
    const { args } = copilotAgent.buildCommand({ prompt: "p", sessionId: "ignored" })
    expect(args).toContain("--continue")
    expect(args).not.toContain("ignored")
  })
})

describe("geminiAgent.buildCommand", () => {
  it("streams JSON and appends the prompt last via -p", () => {
    const { args } = geminiAgent.buildCommand({ prompt: "hello" })
    expect(args.slice(0, 3)).toEqual(["--output-format", "stream-json", "--skip-trust"])
    const idx = args.indexOf("-p")
    expect(args[idx + 1]).toBe("hello")
    expect(idx).toBe(args.length - 2)
  })

  it("switches to --approval-mode plan in plan mode", () => {
    const plan = geminiAgent.buildCommand({ prompt: "p", planMode: true }).args
    const idx = plan.indexOf("--approval-mode")
    expect(plan[idx + 1]).toBe("plan")
    expect(plan).not.toContain("--yolo")
  })
})

describe("piAgent.buildCommand", () => {
  it("includes JSON mode, system prompt, model and a valueless --continue", () => {
    const { args } = piAgent.buildCommand({
      prompt: "p",
      systemPrompt: "sys",
      model: "sonnet",
      sessionId: "s1",
    })
    expect(args.slice(0, 2)).toEqual(["--mode", "json"])
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("sys")
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet")
    expect(args).toContain("--continue")
    expect(args[args.indexOf("-p") + 1]).toBe("p")
  })
})

describe("gooseAgent.buildCommand", () => {
  it("wraps in bash with a PATH export prefix", () => {
    const { cmd, args, wrapInBash } = gooseAgent.buildCommand({ prompt: "p" })
    expect(cmd).toBe("bash")
    expect(args[0]).toBe("-c")
    expect(args[1]).toContain('export PATH="$HOME/.local/bin:$PATH" &&')
    expect(args[1]).toContain("'goose' 'run' '--output-format' 'stream-json'")
    expect(wrapInBash).toBe(false)
  })

  it("derives the anthropic provider for claude models, openai otherwise", () => {
    expect(gooseAgent.buildCommand({ prompt: "p", model: "claude-3" }).args[1]).toContain(
      "'--provider' 'anthropic' '--model' 'claude-3'"
    )
    expect(gooseAgent.buildCommand({ prompt: "p", model: "gpt-4o" }).args[1]).toContain(
      "'--provider' 'openai' '--model' 'gpt-4o'"
    )
  })

  it("prepends /plan to the prompt in plan mode", () => {
    expect(gooseAgent.buildCommand({ prompt: "fix it", planMode: true }).args[1]).toContain(
      "'--text' '/plan fix it'"
    )
  })

  it("passes the system prompt via --system", () => {
    expect(gooseAgent.buildCommand({ prompt: "p", systemPrompt: "sys" }).args[1]).toContain(
      "'--system' 'sys'"
    )
  })
})

describe.each([
  ["kilo", kiloAgent, "--auto"],
  ["opencode", opencodeAgent, "medium"],
] as const)("%s buildCommand (bash-wrapped)", (_name, agent, marker) => {
  it("runs under bash -lc and redirects stderr", () => {
    const { cmd, args } = agent.buildCommand({ prompt: "p" })
    expect(cmd).toBe("bash")
    expect(args[0]).toBe("-lc")
    expect(args[1]).toContain(marker)
    expect(args[1].endsWith("2>&1")).toBe(true)
  })

  it("uses -m for model, -s for resume, and a -- prompt sentinel", () => {
    const { args } = agent.buildCommand({ prompt: "hi", model: "m1", sessionId: "s1" })
    expect(args[1]).toContain("'-m' 'm1'")
    expect(args[1]).toContain("'-s' 's1'")
    expect(args[1]).toContain("'--' 'hi'")
  })

  it("escapes single quotes in the prompt", () => {
    const { args } = agent.buildCommand({ prompt: "it's" })
    expect(args[1]).toContain("'it'\\''s'")
  })
})
