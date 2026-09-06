/**
 * Tests for ensureSandboxForChat.
 *
 * Two invariants:
 *  1. A chat ends up with a usable sandbox whenever one can be created — a
 *     deleted sandbox is recreated through the *same* path as first-time
 *     creation (including local NEW_REPOSITORY chats), so the first message
 *     after a deletion never errors with SANDBOX_NOT_FOUND.
 *  2. Any path that produces a *fresh* sandbox drops the stale agent session
 *     pointer (agent-agnostically). A fresh sandbox is an empty clone with no
 *     on-disk history, so resuming an old `sessionId` makes the agent CLI fail
 *     with "No conversation found with session ID".
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

// This suite only exercises sandbox-lifecycle branching, not environment
// resolution (that's covered by lib/environments.test.ts and
// lib/sandbox-create-params.test.ts), so stub it out to a fixed value.
const resolveEnvironmentForChat = vi.fn()
vi.mock("@/lib/environments", () => ({
  resolveEnvironmentForChat: (args: unknown) => resolveEnvironmentForChat(args),
}))

import { ensureSandboxForChat, type SandboxState } from "./ensure-sandbox"

const freshSandbox = { id: "sbx-new", state: "started" }

type ChatOverrides = {
  sessionId?: string | null
  sandboxId?: string | null
  branch?: string | null
  repo?: string
}

function setup(overrides: ChatOverrides = {}) {
  const chat = {
    id: "chat-1",
    repo: overrides.repo ?? "octocat/hello",
    baseBranch: "main",
    branch: overrides.branch ?? null,
    sandboxId: overrides.sandboxId ?? null,
    previewUrlPattern: null,
    sessionId: overrides.sessionId ?? null,
  }
  const state: SandboxState = {
    sandboxId: chat.sandboxId,
    branch: chat.branch,
    previewUrlPattern: null,
    createdSandbox: false,
  }
  const daytonaGet = vi.fn()
  const params = {
    daytona: { get: daytonaGet } as never,
    chat: chat as never,
    chatId: "chat-1",
    payload: {
      message: "hi",
      agent: "claude-code",
      model: "sonnet",
      userMessageId: "u1",
      assistantMessageId: "a1",
    } as never,
    githubToken: "ghtoken" as string | null,
    userId: "user-1",
    state,
  }
  return { chat, params, daytonaGet }
}

/** The DB update that records the new sandbox as ready. */
function readyUpdate() {
  return chatUpdate.mock.calls
    .map((c) => c[0] as { data?: Record<string, unknown> })
    .find((a) => a.data?.status === "ready")
}

function createArg() {
  return createSandboxForChat.mock.calls[0]?.[0] as {
    newBranch: string
    restoreExistingBranch: boolean
    repo: string
    environment: unknown
  }
}

beforeEach(() => {
  chatUpdate.mockReset().mockResolvedValue(undefined)
  createSandboxForChat.mockReset().mockResolvedValue({
    sandbox: freshSandbox,
    sandboxId: "sbx-new",
    branch: "agent/abcd1234",
    previewUrlPattern: null,
    repoName: "project",
    branchRestored: false,
  })
  ensureSandboxStarted.mockReset().mockResolvedValue(undefined)
  installSkillsForRepo.mockReset().mockResolvedValue({ installed: 0, total: 0 })
  resolveEnvironmentForChat.mockReset().mockResolvedValue(null)
})

describe("ensureSandboxForChat — first-time creation", () => {
  it("creates a sandbox and clears any stale session pointer", async () => {
    const { chat, params } = setup({ sessionId: "stale-123" })

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).toHaveBeenCalledOnce()
    expect(createArg().restoreExistingBranch).toBe(false)
    expect(chat.sessionId).toBeNull()
    expect(readyUpdate()!.data).toHaveProperty("sessionId", null)
  })

  it("resolves the chat's environment and forwards it to createSandboxForChat", async () => {
    const resolvedEnvironment = {
      id: "env_123",
      name: "Staging",
      repo: "octocat/hello",
      isDefault: false,
      networkMode: "full",
      allowedDomains: [],
      variables: { NPM_TOKEN: "tok" },
      setupScript: null,
    }
    resolveEnvironmentForChat.mockResolvedValue(resolvedEnvironment)
    const { params } = setup()

    await ensureSandboxForChat(params)

    expect(resolveEnvironmentForChat).toHaveBeenCalledWith({
      userId: "user-1",
      repo: "octocat/hello",
      environmentId: null,
    })
    expect(createArg().environment).toBe(resolvedEnvironment)
  })
})

describe("ensureSandboxForChat — reuse", () => {
  it("reuses an existing sandbox without recreating", async () => {
    const { params, daytonaGet } = setup({ sandboxId: "old-sbx", branch: "agent/work" })
    daytonaGet.mockResolvedValue({ id: "old-sbx", state: "stopped" })

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).not.toHaveBeenCalled()
    expect(ensureSandboxStarted).toHaveBeenCalledWith({ id: "old-sbx", state: "stopped" })
  })
})

describe("ensureSandboxForChat — deleted sandbox recreation", () => {
  it("recreates and restores the branch when daytona.get 404s, resetting the session", async () => {
    const { chat, params, daytonaGet } = setup({
      sandboxId: "old-sbx",
      branch: "agent/work",
      sessionId: "stale-123",
    })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).toHaveBeenCalledOnce()
    expect(createArg()).toMatchObject({ newBranch: "agent/work", restoreExistingBranch: true })
    expect(chat.sessionId).toBeNull()
    expect(readyUpdate()!.data).toHaveProperty("sessionId", null)
  })

  it("recreates a deleted LOCAL (NEW_REPOSITORY) sandbox instead of erroring", async () => {
    // Regression: local chats used to get SANDBOX_NOT_FOUND on the first
    // message after a deletion, succeeding only on the retry.
    const { params, daytonaGet } = setup({ sandboxId: "old-sbx", repo: "__new__" })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createSandboxForChat).toHaveBeenCalledOnce()
    expect(createArg().repo).toBe("__new__")
  })

  it("falls back to a fresh branch when the chat has no branch to restore", async () => {
    const { params, daytonaGet } = setup({ sandboxId: "old-sbx", branch: null })
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).not.toBeInstanceOf(Response)
    expect(createArg().restoreExistingBranch).toBe(false)
    expect(createArg().newBranch).toMatch(/^agent\//)
  })
})

describe("ensureSandboxForChat — unrecoverable", () => {
  it("returns 410 only when a cloned repo has no GitHub token to re-clone with", async () => {
    const { params, daytonaGet } = setup({ sandboxId: "old-sbx", branch: "agent/work" })
    params.githubToken = null
    daytonaGet.mockRejectedValue(new Error("404 not found"))

    const result = await ensureSandboxForChat(params)

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(410)
    expect(createSandboxForChat).not.toHaveBeenCalled()
  })
})
