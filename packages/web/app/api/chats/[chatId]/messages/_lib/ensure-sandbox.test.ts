/**
 * Tests for ensureSandboxForChat's handling of the chat session pointer when a
 * brand-new sandbox is created.
 *
 * A freshly created sandbox is an empty clone with no agent conversation history
 * on disk. If the chat still carries a `sessionId` from a previous (now gone)
 * sandbox, resuming it makes the agent CLI fail with
 * "No conversation found with session ID". So any path that produces a fresh
 * sandbox must drop the stale session pointer — agent-agnostically.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────
const chatUpdate = vi.fn()
vi.mock("@/lib/db/prisma", () => ({
  prisma: { chat: { update: (args: unknown) => chatUpdate(args) } },
}))

const createSandboxForChat = vi.fn()
const ensureSandboxStarted = vi.fn()
const installSkillsForRepo = vi.fn()
vi.mock("@/lib/sandbox", () => ({
  createSandboxForChat: (args: unknown) => createSandboxForChat(args),
  ensureSandboxStarted: (s: unknown) => ensureSandboxStarted(s),
  installSkillsForRepo: (s: unknown, u: unknown, r: unknown) =>
    installSkillsForRepo(s, u, r),
}))

import { ensureSandboxForChat, type SandboxState } from "./ensure-sandbox"

const fakeSandbox = { id: "sbx-new", state: "started" }

function baseParams(overrides: { sessionId: string | null }) {
  const chat = {
    id: "chat-1",
    repo: "octocat/hello",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    previewUrlPattern: null,
    sessionId: overrides.sessionId,
  }
  const state: SandboxState = {
    sandboxId: null,
    branch: null,
    previewUrlPattern: null,
    createdSandbox: false,
  }
  return {
    daytona: { get: vi.fn().mockResolvedValue(fakeSandbox) } as never,
    chat: chat as never,
    chatId: "chat-1",
    payload: {
      message: "hi",
      agent: "claude-code",
      model: "sonnet",
      userMessageId: "u1",
      assistantMessageId: "a1",
    } as never,
    githubToken: "ghtoken",
    userId: "user-1",
    state,
    chatRef: chat,
  }
}

beforeEach(() => {
  chatUpdate.mockReset().mockResolvedValue(undefined)
  createSandboxForChat.mockReset().mockResolvedValue({
    sandbox: fakeSandbox,
    sandboxId: "sbx-new",
    branch: "agent/abcd1234",
    previewUrlPattern: null,
    repoName: "project",
  })
  ensureSandboxStarted.mockReset().mockResolvedValue(undefined)
  installSkillsForRepo.mockReset().mockResolvedValue({ installed: 0, total: 0 })
})

describe("ensureSandboxForChat — fresh sandbox creation", () => {
  it("clears a stale session pointer so the agent does not resume a dead session", async () => {
    const params = baseParams({ sessionId: "stale-session-123" })

    const result = await ensureSandboxForChat(params)

    // Should not have early-returned a SANDBOX_NOT_FOUND response.
    expect(result).not.toBeInstanceOf(Response)

    // The in-memory chat row the caller reads for `--resume` must be cleared.
    expect(params.chatRef.sessionId).toBeNull()

    // The DB update that records the new sandbox must also null the session.
    const readyUpdate = chatUpdate.mock.calls
      .map((c) => c[0] as { data?: Record<string, unknown> })
      .find((a) => a.data?.status === "ready")
    expect(readyUpdate).toBeDefined()
    expect(readyUpdate!.data).toHaveProperty("sessionId", null)
  })

  it("is a no-op for the session pointer on a brand-new chat (already null)", async () => {
    const params = baseParams({ sessionId: null })

    await ensureSandboxForChat(params)

    expect(params.chatRef.sessionId).toBeNull()
    const readyUpdate = chatUpdate.mock.calls
      .map((c) => c[0] as { data?: Record<string, unknown> })
      .find((a) => a.data?.status === "ready")
    expect(readyUpdate!.data).toHaveProperty("sessionId", null)
  })
})
