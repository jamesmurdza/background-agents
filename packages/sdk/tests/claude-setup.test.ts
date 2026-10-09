/**
 * Claude agent setup tests - tests for the CLAUDE_CODE_CREDENTIALS environment variable handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { claudeAgent } from "../src/agents/index.js"
import type { CodeAgentSandbox } from "../src/types/provider.js"

describe("Claude agent setup", () => {
  let mockSandbox: CodeAgentSandbox
  let executedCommands: string[]

  beforeEach(() => {
    executedCommands = []
    mockSandbox = {
      ensureProvider: vi.fn().mockResolvedValue(undefined),
      setEnvVars: vi.fn(),
      executeCommand: vi.fn().mockImplementation(async (command: string) => {
        executedCommands.push(command)
        if (command === "claude --version") return { exitCode: 0, output: "2.1.283 (Claude Code)" }
        return { exitCode: 0, output: "" }
      }),
    }
  })

  it("should have a setup capability", () => {
    expect(claudeAgent.capabilities?.setup).toBeDefined()
    expect(typeof claudeAgent.capabilities?.setup).toBe("function")
  })

  it("sets up host OAuth recovery without writing shared subscription credentials", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    const env = {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    }
    await setup(mockSandbox, env)
    expect(executedCommands.some((command) => command.includes("oauth_token_refresh"))).toBe(true)
    expect(executedCommands.some((command) => command.includes("rm -f '/home/daytona/.claude/.credentials.json'"))).toBe(true)
    expect(executedCommands.join("\n")).not.toContain(env.CLAUDE_CODE_TOKEN_AUTH)
    const spec = claudeAgent.buildCommand({ prompt: "continue the work", env })
    expect(spec.cmd).toBe("node")
    expect(spec.args.at(-1)).toBe("continue the work")
  })

  it.each(["exit-code", "exception"])("rejects a runner installation failure safely (%s)", async (failure) => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    const execute = vi.mocked(mockSandbox.executeCommand!)
    execute.mockImplementation(async (command) => {
      if (command === "claude --version") return { exitCode: 0, output: "2.1.283 (Claude Code)" }
      if (failure === "exception") throw new Error("credential-bearing-output-test")
      return { exitCode: 1, output: "credential-bearing-output-test" }
    })
    await expect(setup(mockSandbox, {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    })).rejects.toThrow(/^Failed to install the shared Claude OAuth runner$/)
  })

  it.each(["2.1.282", "2.1.284", "2.2.0"])("updates a mismatched shared Claude CLI (%s) to the tested version", async (version) => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    let installed = false
    const commands: string[] = []
    vi.mocked(mockSandbox.executeCommand!).mockImplementation(async (command) => {
      commands.push(command)
      if (command === "claude --version") {
        return { exitCode: 0, output: `${installed ? "2.1.283" : version} (Claude Code)` }
      }
      if (command === "sudo -n npm install -g @anthropic-ai/claude-code@2.1.283") installed = true
      return { exitCode: 0, output: "" }
    })
    await setup(mockSandbox, {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    })
    expect(commands.slice(0, 3)).toEqual([
      "claude --version",
      "sudo -n npm install -g @anthropic-ai/claude-code@2.1.283",
      "claude --version",
    ])
    expect(commands[3]).toContain("oauth_token_refresh")
  })

  it("rejects a failed shared CLI update without exposing command output", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    vi.mocked(mockSandbox.executeCommand!).mockResolvedValue({ exitCode: 1, output: "credential-bearing-output-test" })
    await expect(setup(mockSandbox, {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    })).rejects.toThrow(/^Failed to install Claude Code 2\.1\.283 for shared OAuth recovery$/)
  })

  it("rejects a CLI that still resolves to another version after installation", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    vi.mocked(mockSandbox.executeCommand!).mockResolvedValue({ exitCode: 0, output: "2.2.0 (Claude Code)" })
    await expect(setup(mockSandbox, {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    })).rejects.toThrow(/^Shared OAuth recovery requires Claude Code 2\.1\.283 on PATH$/)
  })

  it("requires command execution to install the shared OAuth runner", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")
    const sandbox: CodeAgentSandbox = { ensureProvider: vi.fn(), setEnvVars: vi.fn() }
    await expect(setup(sandbox, {
      CLAUDE_CODE_TOKEN_URL: "https://app.test/api/claude-token",
      CLAUDE_CODE_TOKEN_AUTH: "run-capability-test",
    })).rejects.toThrow("Shared Claude OAuth recovery requires sandbox command execution")
  })

  it("should write credentials file when CLAUDE_CODE_CREDENTIALS is set", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")

    const credentials = '{"claudeAiOauth":{"accessToken":"sk-ant-oa-test-token"}}'
    await setup(mockSandbox, { CLAUDE_CODE_CREDENTIALS: credentials })

    expect(executedCommands).toHaveLength(1)
    expect(executedCommands[0]).toContain("mkdir -p")
    expect(executedCommands[0]).toContain(".claude")
    expect(executedCommands[0]).toContain("chmod 600")
    expect(executedCommands[0]).toContain(credentials)
  })

  it("should escape single quotes in credentials", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")

    const credentials = "{'key':'value's'}"
    await setup(mockSandbox, { CLAUDE_CODE_CREDENTIALS: credentials })

    expect(executedCommands).toHaveLength(1)
    // Single quotes should be escaped as '\''
    expect(executedCommands[0]).toContain("'\\''")
  })

  it("should not write credentials when CLAUDE_CODE_CREDENTIALS is not set", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")

    await setup(mockSandbox, {})

    expect(executedCommands).toHaveLength(0)
  })

  it("should not write credentials when CLAUDE_CODE_CREDENTIALS is empty", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")

    await setup(mockSandbox, { CLAUDE_CODE_CREDENTIALS: "" })

    expect(executedCommands).toHaveLength(0)
  })

  it("should not fail when executeCommand is not available", async () => {
    const setup = claudeAgent.capabilities?.setup
    if (!setup) throw new Error("Setup not defined")

    const sandboxWithoutExecute: CodeAgentSandbox = {
      ensureProvider: vi.fn().mockResolvedValue(undefined),
      setEnvVars: vi.fn(),
      // executeCommand is undefined
    }

    // Should not throw
    await expect(
      setup(sandboxWithoutExecute, { CLAUDE_CODE_CREDENTIALS: '{"token":"test"}' })
    ).resolves.toBeUndefined()
  })
})
