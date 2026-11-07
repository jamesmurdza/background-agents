import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so these helpers can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { message } = vi.hoisted(() => ({
  message: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { message } }))

import {
  createPushFailedMessage,
  clearPushFailureMessages,
  clearRebaseSuggestionMessages,
} from "./git-messages"

beforeEach(() => {
  message.findFirst.mockReset()
  message.create.mockReset()
  message.deleteMany.mockReset()
  message.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "m1",
    timestamp: BigInt(0),
    linkBranch: null,
    ...data,
  }))
})

describe("createPushFailedMessage", () => {
  it("creates a force-push failure message when none is outstanding", async () => {
    message.findFirst.mockResolvedValue(null)

    const result = await createPushFailedMessage("chat-1", "non-fast-forward")

    expect(result).not.toBeNull()
    expect(message.create).toHaveBeenCalledTimes(1)
    const data = message.create.mock.calls[0][0].data
    expect(data.isError).toBe(true)
    expect(data.metadata).toMatchObject({ action: "force-push" })
    expect(data.content).toContain("Push failed: non-fast-forward")
  })

  it("suppresses a duplicate when the latest git-op is already a push failure", async () => {
    // Reproduces the spam bug: several finalizers (reconnected SSE streams + the
    // cron lifecycle) fire for the same completed turn.
    message.findFirst.mockResolvedValue({
      isError: true,
      metadata: { action: "force-push" },
    })

    const result = await createPushFailedMessage("chat-1", "non-fast-forward")

    expect(result).toBeNull()
    expect(message.create).not.toHaveBeenCalled()
  })

  it("still records a failure when the latest git-op was a success", async () => {
    message.findFirst.mockResolvedValue({ isError: false, metadata: null })

    const result = await createPushFailedMessage("chat-1", "boom")

    expect(result).not.toBeNull()
    expect(message.create).toHaveBeenCalledTimes(1)
  })
})

describe("clearPushFailureMessages", () => {
  it("deletes outstanding force-push failure messages for the chat", async () => {
    message.deleteMany.mockResolvedValue({ count: 1 })

    await clearPushFailureMessages("chat-1")

    expect(message.deleteMany).toHaveBeenCalledTimes(1)
    expect(message.deleteMany.mock.calls[0][0].where).toMatchObject({
      chatId: "chat-1",
      messageType: "git-operation",
      isError: true,
      metadata: { path: ["action"], equals: "force-push" },
    })
  })
})

describe("clearRebaseSuggestionMessages", () => {
  it("deletes outstanding rebase-instead suggestions for the chat", async () => {
    message.deleteMany.mockResolvedValue({ count: 1 })

    await clearRebaseSuggestionMessages("chat-1")

    expect(message.deleteMany).toHaveBeenCalledTimes(1)
    expect(message.deleteMany.mock.calls[0][0].where).toMatchObject({
      chatId: "chat-1",
      messageType: "git-operation",
      isError: true,
      metadata: { path: ["action"], equals: "rebase" },
    })
  })
})
