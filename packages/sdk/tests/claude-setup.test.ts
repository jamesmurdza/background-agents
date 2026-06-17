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
        return { exitCode: 0, output: "" }
      }),
    }
  })

  it("should have a setup capability", () => {
    expect(claudeAgent.capabilities?.setup).toBeDefined()
    expect(typeof claudeAgent.capabilities?.setup).toBe("function")
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
