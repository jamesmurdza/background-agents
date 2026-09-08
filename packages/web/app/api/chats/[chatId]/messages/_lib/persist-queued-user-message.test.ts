import { describe, it, expect, vi, beforeEach } from "vitest"

const findMany = vi.fn()
const upsert = vi.fn()
const chatUpdate = vi.fn()

const tx = {
  message: { findMany, upsert },
  chat: { update: chatUpdate },
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  },
}))
vi.mock("@prisma/client", () => ({ Prisma: {} }))

const { persistQueuedUserMessage } = await import("./persist-queued-user-message")

const payload = {
  message: "fix the build",
  agent: "claude-code",
  model: "sonnet",
  userMessageId: "msg_user",
  assistantMessageId: "msg_assistant",
} as never as Parameters<typeof persistQueuedUserMessage>[0]["payload"]

describe("persistQueuedUserMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMany.mockResolvedValue([])
    upsert.mockResolvedValue({})
  })

  it("writes the user message so a disconnected client cannot lose it", async () => {
    await persistQueuedUserMessage({
      chatId: "chat_1",
      payload,
      agentPrompt: "fix the build",
      uploadedFilePaths: ["/uploads/a.png"],
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    const call = upsert.mock.calls[0][0]
    expect(call.where).toEqual({ id: "msg_user" })
    expect(call.create.role).toBe("user")
    expect(call.create.content).toBe("fix the build")
    expect(call.create.uploadedFiles).toEqual(["/uploads/a.png"])
  })

  it("writes no assistant placeholder, so history replay still sees an unanswered chat", async () => {
    await persistQueuedUserMessage({
      chatId: "chat_1",
      payload,
      agentPrompt: "fix the build",
      uploadedFilePaths: [],
    })

    const ids = upsert.mock.calls.map((c) => c[0].where.id)
    expect(ids).not.toContain("msg_assistant")
  })

  it("leaves the chat status alone: only the dispatcher may leave setting_up", async () => {
    await persistQueuedUserMessage({
      chatId: "chat_1",
      payload,
      agentPrompt: "fix the build",
      uploadedFilePaths: [],
    })

    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it("refuses a message id that belongs to another chat", async () => {
    findMany.mockResolvedValue([{ id: "msg_user", chatId: "other_chat" }])

    await expect(
      persistQueuedUserMessage({
        chatId: "chat_1",
        payload,
        agentPrompt: "fix the build",
        uploadedFilePaths: [],
      })
    ).rejects.toThrow("Message ID belongs to a different chat")
    expect(upsert).not.toHaveBeenCalled()
  })
})
