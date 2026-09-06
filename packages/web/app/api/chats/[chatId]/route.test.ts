import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
const { chat, environment } = vi.hoisted(() => ({
  chat: {
    update: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  environment: {
    findFirst: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { chat, environment } }))

const { getChatWithAuth } = vi.hoisted(() => ({
  getChatWithAuth: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  getChatWithAuth,
  badRequest: vi.fn((message: string) => Response.json({ error: message }, { status: 400 })),
  notFound: vi.fn((message: string) => Response.json({ error: message }, { status: 404 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 })
  ),
}))

const { getOrCreateDefaultEnvironment } = vi.hoisted(() => ({
  getOrCreateDefaultEnvironment: vi.fn(),
}))
vi.mock("@/lib/environments", () => ({ getOrCreateDefaultEnvironment }))

import { PATCH } from "./route"

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/chats/chat_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
}

function existingChat(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "chat_1",
    userId: "u1",
    repo: "acme/app",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    previewUrlPattern: null,
    backgroundSessionId: null,
    agent: "claude-code",
    model: null,
    planModeEnabled: false,
    displayName: null,
    shareId: null,
    status: "pending",
    archived: false,
    pinned: false,
    parentChatId: null,
    needsSync: false,
    environmentVariables: null,
    environmentId: "env_old",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: new Date(),
    ...overrides,
  }
}

function updatedChatRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...existingChat(),
    ...overrides,
  }
}

async function callPatch(chatId: string, body: unknown) {
  return PATCH(makeRequest(body), { params: Promise.resolve({ chatId }) })
}

beforeEach(() => {
  chat.update.mockReset()
  chat.findMany.mockReset()
  chat.updateMany.mockReset()
  environment.findFirst.mockReset()
  getChatWithAuth.mockReset()
  getOrCreateDefaultEnvironment.mockReset()
})

describe("PATCH /api/chats/[chatId]: environmentId", () => {
  it("accepts an explicit environmentId that belongs to the chat's current repo", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat())
    environment.findFirst.mockResolvedValueOnce({ id: "env_new" })
    chat.update.mockResolvedValueOnce(updatedChatRow({ environmentId: "env_new" }))

    const res = await callPatch("chat_1", { environmentId: "env_new" })
    const body = await res.json()

    expect(environment.findFirst).toHaveBeenCalledWith({
      where: { id: "env_new", userId: "u1", repo: "acme/app" },
      select: { id: true },
    })
    expect(chat.update.mock.calls[0][0].data.environmentId).toBe("env_new")
    expect(res.status).toBe(200)
    expect(body.environmentId).toBe("env_new")
  })

  it("rejects an environmentId that belongs to a different repo", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat())
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await callPatch("chat_1", { environmentId: "someone-elses-env" })

    expect(res.status).toBe(400)
    expect(chat.update).not.toHaveBeenCalled()
  })

  it("re-resolves the default environment when the repo changes without an explicit environmentId", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat({ repo: "acme/app" }))
    getOrCreateDefaultEnvironment.mockResolvedValueOnce({ id: "env_acme_other_default" })
    chat.update.mockResolvedValueOnce(
      updatedChatRow({ repo: "acme/other", environmentId: "env_acme_other_default" })
    )

    const res = await callPatch("chat_1", { repo: "acme/other" })
    const body = await res.json()

    expect(getOrCreateDefaultEnvironment).toHaveBeenCalledWith("u1", "acme/other")
    expect(chat.update.mock.calls[0][0].data.environmentId).toBe("env_acme_other_default")
    expect(body.environmentId).toBe("env_acme_other_default")
  })

  it("clears environmentId when the repo changes to NEW_REPOSITORY without an explicit environmentId", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat({ repo: "acme/app" }))
    chat.update.mockResolvedValueOnce(updatedChatRow({ repo: "__new__", environmentId: null }))

    const res = await callPatch("chat_1", { repo: "__new__" })
    const body = await res.json()

    expect(getOrCreateDefaultEnvironment).not.toHaveBeenCalled()
    expect(chat.update.mock.calls[0][0].data.environmentId).toBeNull()
    expect(body.environmentId).toBeNull()
  })

  it("validates an explicit environmentId against the new repo when both are sent in the same PATCH", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat({ repo: "acme/app" }))
    environment.findFirst.mockResolvedValueOnce({ id: "env_new_repo" })
    chat.update.mockResolvedValueOnce(
      updatedChatRow({ repo: "acme/other", environmentId: "env_new_repo" })
    )

    const res = await callPatch("chat_1", { repo: "acme/other", environmentId: "env_new_repo" })

    expect(environment.findFirst).toHaveBeenCalledWith({
      where: { id: "env_new_repo", userId: "u1", repo: "acme/other" },
      select: { id: true },
    })
    expect(getOrCreateDefaultEnvironment).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it("leaves environmentId untouched when neither repo nor environmentId is in the PATCH", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat())
    chat.update.mockResolvedValueOnce(updatedChatRow({ displayName: "Renamed" }))

    await callPatch("chat_1", { displayName: "Renamed" })

    expect(chat.update.mock.calls[0][0].data.environmentId).toBeUndefined()
    expect(environment.findFirst).not.toHaveBeenCalled()
    expect(getOrCreateDefaultEnvironment).not.toHaveBeenCalled()
  })

  it("rejects a non-string environmentId (including null) with a 400, not an internal error", async () => {
    getChatWithAuth.mockResolvedValueOnce(existingChat())

    const res = await callPatch("chat_1", { environmentId: null })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("environmentId")
    expect(environment.findFirst).not.toHaveBeenCalled()
    expect(chat.update).not.toHaveBeenCalled()
  })

  describe("once the chat has a sandbox", () => {
    it("rejects an explicit environmentId change with a 400", async () => {
      getChatWithAuth.mockResolvedValueOnce(existingChat({ sandboxId: "sb_1" }))

      const res = await callPatch("chat_1", { environmentId: "env_new" })

      expect(res.status).toBe(400)
      expect(environment.findFirst).not.toHaveBeenCalled()
      expect(chat.update).not.toHaveBeenCalled()
    })

    it("rejects a repo change that would re-resolve environmentId with a 400", async () => {
      getChatWithAuth.mockResolvedValueOnce(existingChat({ sandboxId: "sb_1", repo: "acme/app" }))

      const res = await callPatch("chat_1", { repo: "acme/other" })

      expect(res.status).toBe(400)
      expect(getOrCreateDefaultEnvironment).not.toHaveBeenCalled()
      expect(chat.update).not.toHaveBeenCalled()
    })

    it("still allows an unrelated field update (no repo or environmentId in the body)", async () => {
      getChatWithAuth.mockResolvedValueOnce(existingChat({ sandboxId: "sb_1" }))
      chat.update.mockResolvedValueOnce(updatedChatRow({ sandboxId: "sb_1", displayName: "Renamed" }))

      const res = await callPatch("chat_1", { displayName: "Renamed" })

      expect(res.status).toBe(200)
    })

    it("still allows setting repo to its own current value (no-op repo, no environment re-resolution)", async () => {
      getChatWithAuth.mockResolvedValueOnce(existingChat({ sandboxId: "sb_1", repo: "acme/app" }))
      chat.update.mockResolvedValueOnce(updatedChatRow({ sandboxId: "sb_1", repo: "acme/app" }))

      const res = await callPatch("chat_1", { repo: "acme/app", baseBranch: "main" })

      expect(res.status).toBe(200)
      expect(getOrCreateDefaultEnvironment).not.toHaveBeenCalled()
    })
  })
})
