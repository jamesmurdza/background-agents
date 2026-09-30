/**
 * resyncSharedClaudeCredentials pushes the current shared Claude credential
 * into a running sandbox on every cron tick, so a long-running turn never has
 * to rely on its own (now-disabled, see lib/claude-credentials.ts)
 * self-refresh. The one thing that must never happen: overwriting a
 * sandbox belonging to a user with their OWN Claude credentials — that would
 * clobber their token with the shared pool's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const getUserCredentials = vi.fn()
vi.mock("@/lib/db/api-helpers", () => ({
  getUserCredentials: (...a: unknown[]) => getUserCredentials(...a),
}))

const getSandboxClaudeCredentials = vi.fn()
vi.mock("@/lib/claude-credentials", () => ({
  getSandboxClaudeCredentials: (...a: unknown[]) => getSandboxClaudeCredentials(...a),
}))

const setup = vi.fn()
const getAgent = vi.fn()
const adaptSandbox = vi.fn((...args: unknown[]) => args[0])
vi.mock("@background-agents/sdk", () => ({
  getAgent: (...a: unknown[]) => getAgent(...a),
  adaptSandbox: (...a: unknown[]) => adaptSandbox(...a),
}))

import { resyncSharedClaudeCredentials } from "./claude-credential-sync"

const SANDBOX_ID = "sbx-1"
const rawSandbox = { marker: "raw-sandbox" }
const daytonaGet = vi.fn(async () => rawSandbox)
const daytona = { get: daytonaGet } as never

beforeEach(() => {
  vi.clearAllMocks()
  getUserCredentials.mockResolvedValue({})
  getSandboxClaudeCredentials.mockResolvedValue('{"claudeAiOauth":{"accessToken":"fresh"}}')
  getAgent.mockReturnValue({ capabilities: { setup } })
})

describe("resyncSharedClaudeCredentials", () => {
  it("writes the fresh shared credential into the sandbox for a claude-code shared-pool run", async () => {
    await resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "claude-code", "default", daytona)

    expect(daytonaGet).toHaveBeenCalledWith(SANDBOX_ID)
    expect(setup).toHaveBeenCalledTimes(1)
    const [sandboxArg, envArg] = setup.mock.calls[0] as [unknown, Record<string, string>]
    expect(sandboxArg).toBe(rawSandbox) // adaptSandbox is mocked as identity here
    expect(envArg.CLAUDE_CODE_CREDENTIALS).toBe('{"claudeAiOauth":{"accessToken":"fresh"}}')
  })

  it("does nothing for a non-claude-code agent", async () => {
    await resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "opencode", "default", daytona)
    expect(daytonaGet).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
  })

  it("does nothing for a custom-endpoint model", async () => {
    await resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "claude-code", "endpoint:c1", daytona)
    expect(daytonaGet).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
  })

  it("never overwrites a sandbox for a user with their own stored Claude credentials", async () => {
    getUserCredentials.mockResolvedValue({ CLAUDE_CODE_CREDENTIALS: "user-own-token-blob" })
    await resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "claude-code", "default", daytona)
    expect(daytonaGet).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
  })

  it("swallows errors instead of throwing, so a bad tick can't break the monitor loop", async () => {
    getSandboxClaudeCredentials.mockRejectedValue(new Error("db down"))
    await expect(
      resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "claude-code", "default", daytona)
    ).resolves.toBeUndefined()
  })

  it("no-ops when the claude agent has no setup hook registered", async () => {
    getAgent.mockReturnValue({ capabilities: {} })
    await resyncSharedClaudeCredentials(SANDBOX_ID, "u1", "claude-code", "default", daytona)
    expect(setup).not.toHaveBeenCalled()
  })
})
