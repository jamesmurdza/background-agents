import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "./types"
import type { ChatWithMessagesResponse, MessageResponse, PromptQueueResponse } from "./sync/api"

const fetchChat = vi.fn()
vi.mock("./sync/api", async (importActual) => ({
  ...(await importActual<typeof import("./sync/api")>()),
  fetchChat: (...args: unknown[]) => fetchChat(...args),
}))

const { applyQueueSnapshot, deltaCoversHistory, loadQueueMessages, withoutMessageProgress } = await import("./queue-sync")

const row = (id: string, content = id, timestamp = 1): MessageResponse => ({
  id, role: "assistant", content, timestamp, messageType: null, isError: false, toolCalls: null,
  contentBlocks: null, uploadedFiles: null, linkBranch: null, metadata: null, agent: null, model: null,
})
const response = (messages: MessageResponse[], messageCount: number, syncedAt = 200) =>
  ({ id: "chat-1", status: "running", updatedAt: 5, messages, messageCount, syncedAt }) as unknown as ChatWithMessagesResponse
const local = (ids: string[], extra: Partial<Chat> = {}) => ({
  id: "chat-1", status: "running", updatedAt: 1, queuedMessages: [], messageCount: ids.length,
  messages: ids.map((id, index) => ({ id, role: "assistant", content: id, timestamp: index + 1 })), ...extra,
}) as Chat

describe("delta history sync", () => {
  beforeEach(() => fetchChat.mockReset())

  it("downloads the full history when the chat has never been synced", async () => {
    fetchChat.mockResolvedValueOnce(response([row("a"), row("b")], 2))
    const detail = await loadQueueMessages("chat-1", local(["a"]))
    expect(fetchChat).toHaveBeenCalledWith("chat-1")
    expect(detail.messages.map((message) => message.id)).toEqual(["a", "b"])
  })

  it("downloads only changes once a sync point is known", async () => {
    fetchChat.mockResolvedValueOnce(response([row("b", "longer reply", 2)], 2, 300))
    const previous = local(["a", "b"], { messagesSyncedAt: 200 })
    const detail = await loadQueueMessages("chat-1", previous)
    expect(fetchChat).toHaveBeenCalledTimes(1)
    expect(fetchChat).toHaveBeenCalledWith("chat-1", { changedSince: 200 })
    const next = applyQueueSnapshot(previous, { ...detail, queuedMessages: [] } as unknown as PromptQueueResponse, detail)
    expect(next.messages.map((message) => message.content)).toEqual(["a", "longer reply"])
    expect(next.messagesSyncedAt).toBe(300)
  })

  it("falls back to a full read when the delta leaves a gap", async () => {
    fetchChat
      .mockResolvedValueOnce(response([row("c")], 4))
      .mockResolvedValueOnce(response([row("a"), row("b"), row("c"), row("d")], 4))
    const detail = await loadQueueMessages("chat-1", local(["a"], { messagesSyncedAt: 200 }))
    expect(fetchChat).toHaveBeenLastCalledWith("chat-1")
    expect(detail.messages).toHaveLength(4)
  })

  it("falls back to a full read against a server without delta support", async () => {
    fetchChat
      .mockResolvedValueOnce({ ...response([row("a")], 1), syncedAt: undefined })
      .mockResolvedValueOnce(response([row("a")], 1))
    await loadQueueMessages("chat-1", local(["a"], { messagesSyncedAt: 200 }))
    expect(fetchChat).toHaveBeenCalledTimes(2)
  })

  it("ignores inherited parent messages when checking the delta is complete", () => {
    const existing = [{ id: "inherited-p", role: "user", content: "p", timestamp: 0, inherited: true }, { id: "a", role: "user", content: "a", timestamp: 1 }] as Chat["messages"]
    expect(deltaCoversHistory(existing, [], 1)).toBe(true)
    expect(deltaCoversHistory(existing, [], 2)).toBe(false)
  })

  it("keeps message counters when a streaming poll skips the history read", () => {
    const previous = local(["a"], { messageCount: 1, lastMessageId: "a" })
    const remote = { status: "running", queuePaused: false, sandboxId: "s", backgroundSessionId: "t",
      activeAssistantMessageId: "a", queuedMessages: [], updatedAt: 2, messageCount: 3, lastMessageId: "git-op" } as PromptQueueResponse
    const next = applyQueueSnapshot(previous, withoutMessageProgress(remote))
    expect(next.messageCount).toBe(1)
    expect(next.lastMessageId).toBe("a")
    expect(next.updatedAt).toBe(2)
  })
})
