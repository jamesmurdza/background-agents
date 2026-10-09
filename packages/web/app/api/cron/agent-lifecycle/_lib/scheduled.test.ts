import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentSessionOptions } from "@/lib/agent-session"

const state = vi.hoisted(() => ({
  credentials: vi.fn(), readShared: vi.fn(), createSandbox: vi.fn(), createSession: vi.fn(),
  createChat: vi.fn(), updateChat: vi.fn(), createMessages: vi.fn(), updateJobRun: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  account: { findFirst: vi.fn().mockResolvedValue(null) },
  user: { findUnique: vi.fn().mockResolvedValue({ credentials: null }) },
  chat: { create: state.createChat, update: state.updateChat },
  message: { createMany: state.createMessages },
  scheduledJobRun: { update: state.updateJobRun },
} }))
vi.mock("@/lib/db/api-helpers", () => ({ getUserCredentials: state.credentials, decryptUserCredentials: () => ({}) }))
vi.mock("@/lib/db/usage-limit", () => ({ checkSharedPoolUsage: vi.fn().mockResolvedValue({ allowed: true }), UsageLimitError: Error }))
vi.mock("@/lib/claude-credentials", () => ({ getSharedClaudeAccessToken: state.readShared }))
vi.mock("@/lib/server/custom-endpoints", () => ({ getUserEndpoints: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/server/codex-credentials", () => ({ applyCodexSubscription: async (credentials: Record<string, string>) => credentials }))
vi.mock("@/lib/server/shared-pool", () => ({ buildUsageMeta: () => ({ pool: "shared", provider: "claude" }) }))
vi.mock("@/lib/server/token-metering", () => ({ meterAssistantTurn: vi.fn() }))
vi.mock("./meter-turn", () => ({ meterTurnNow: vi.fn() }))
vi.mock("@/lib/db/activity-log", () => ({ logActivityAsync: vi.fn() }))
vi.mock("@/lib/sandbox", () => ({ createSandboxForChat: state.createSandbox, deleteSandboxQuietly: vi.fn() }))
vi.mock("@/lib/agent-session", () => ({ createBackgroundAgentSession: state.createSession, finalizeTurn: vi.fn() }))
vi.mock("@/lib/mcp/agent-servers", () => ({ loadMcpConnections: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/git/push-options", () => ({ getUserPushOptions: vi.fn() }))

import { startJobExecution } from "./scheduled"
import { verifyClaudeTokenCapability } from "@/lib/server/claude-token-auth"
import { NEW_REPOSITORY } from "@/lib/types"

function job(overrides: Record<string, unknown> = {}) {
  return { id: "job-test", userId: "user-test", repo: NEW_REPOSITORY, agent: "claude-code",
    model: "opus", prompt: "Perform the job", continueFromLastRun: false, ...overrides,
  } as unknown as Parameters<typeof startJobExecution>[0]
}
const run = { id: "job-run-test" } as Parameters<typeof startJobExecution>[1]
const daytona = {} as Parameters<typeof startJobExecution>[2]

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "scheduled-token-signing-test")
  vi.stubEnv("CLAUDE_CREDENTIALS_BASE_URL", "https://app.test")
  vi.clearAllMocks()
  state.credentials.mockResolvedValue({})
  state.readShared.mockReset().mockResolvedValue("shared-access-test")
  state.createChat.mockResolvedValue({ id: "chat-test" })
  state.createSandbox.mockResolvedValue({ sandbox: {}, sandboxId: "sandbox-test" })
  state.createSession.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("scheduled Claude authentication", () => {
  it("authorizes the exact active run before starting Claude", async () => {
    const start = vi.fn(async (prompt: string) => {
      expect(prompt).toBe("Perform the job")
      const options = state.createSession.mock.calls[0][1] as AgentSessionOptions
      const scope = verifyClaudeTokenCapability(options.env!.CLAUDE_CODE_TOKEN_AUTH)
      expect(scope).toEqual({ userId: "user-test", chatId: "chat-test", backgroundSessionId: options.backgroundSessionId })
      expect(state.createChat).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ agent: "claude-code", status: "running" }),
      }))
      expect(state.updateChat).toHaveBeenCalledWith({ where: { id: "chat-test" },
        data: { backgroundSessionId: scope!.backgroundSessionId } })
      expect(JSON.stringify(options.env)).not.toContain("shared-access-test")
      expect(options.env?.CLAUDE_CODE_CREDENTIALS).toBeUndefined()
      expect(options.env?.ANTHROPIC_BASE_URL).toBeUndefined()
    })
    state.createSession.mockImplementation(async (_sandbox: unknown, options: AgentSessionOptions) => ({
      backgroundSessionId: options.backgroundSessionId, start,
    }))
    await startJobExecution(job(), run, daytona)
    expect(start).toHaveBeenCalledOnce()
  })

  it("rejects an unavailable shared login before provisioning resources", async () => {
    state.readShared.mockRejectedValue(new Error("Shared login unavailable"))
    await expect(startJobExecution(job(), run, daytona)).rejects.toThrow("Shared login unavailable")
    expect(state.createChat).not.toHaveBeenCalled()
    expect(state.createSandbox).not.toHaveBeenCalled()
    expect(state.createSession).not.toHaveBeenCalled()
  })

  it("keeps a user's own subscription on the existing connection", async () => {
    state.credentials.mockResolvedValue({ CLAUDE_CODE_CREDENTIALS: "own-subscription-test" })
    state.createSession.mockResolvedValue({ backgroundSessionId: "direct-run", start: vi.fn() })
    await startJobExecution(job(), run, daytona)
    const options = state.createSession.mock.calls[0][1] as AgentSessionOptions
    expect(options.env?.CLAUDE_CODE_CREDENTIALS).toBe("own-subscription-test")
    expect(options.env?.CLAUDE_CODE_TOKEN_URL).toBeUndefined()
    expect(state.readShared).not.toHaveBeenCalled()
  })
})
