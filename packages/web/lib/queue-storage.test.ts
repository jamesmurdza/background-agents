import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearAllStorage, clearLocalStateForChats, loadLocalState, migrateDraftToRealChat, setCurrentChatId, setQueuedMessages } from "./storage"

const first = { id: "first", content: "offline A", pendingSync: true }
const second = { id: "second", content: "offline B", pendingSync: true }
let stored: Map<string, string>
beforeEach(() => {
  stored = new Map()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe("per-message durable outbox ownership", () => {
  it("preserves two sends from tabs hydrated before either send", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [second], [])
    expect(loadLocalState().queuedMessages.chat?.map((item) => item.id)).toEqual(["first", "second"])
  })

  it("acknowledges only the message owned by the caller's snapshot", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [second], [])
    setQueuedMessages("chat", undefined, [first])
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
  })

  it("does not resurrect an acknowledged message through a stale metadata update", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", undefined, [first])
    setQueuedMessages("chat", [{ ...first, syncError: "old failed request" }], [first])
    expect(loadLocalState().queuedMessages.chat ?? []).toEqual([])
  })

  it("does not clear another tab's cancellation intent with a late POST result", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("chat", [{ ...first, cancelRequested: true }], [first])
    setQueuedMessages("chat", [{ ...first, userMessageId: "server-user" }], [first])
    expect(loadLocalState().queuedMessages.chat?.[0].cancelRequested).toBe(true)
  })

  it("keeps old browser queues readable without putting new outbox writes into that shared array", () => {
    stored.set("simple-chat-local", JSON.stringify({ queuedMessages: { chat: [first] } }))
    setQueuedMessages("chat", [first, second], [first])
    setQueuedMessages("chat", [second], [first, second])
    setCurrentChatId("another-chat")
    expect(loadLocalState().queuedMessages.chat).toEqual([second])
    const legacy = JSON.parse(stored.get("simple-chat-local")!)
    expect(legacy.queuedMessages.chat).not.toContainEqual(second)
  })

  it("clears all outbox records only when their chat is explicitly deleted", () => {
    setQueuedMessages("chat", [first], [])
    setQueuedMessages("other", [second], [])
    clearLocalStateForChats(["chat"])
    expect(loadLocalState().queuedMessages.chat).toBeUndefined()
    expect(loadLocalState().queuedMessages.other).toEqual([second])
  })

  it("moves draft outbox records and clears them with the existing clear-storage action", () => {
    setQueuedMessages("draft-1", [first], [])
    migrateDraftToRealChat("draft-1", "chat-1")
    expect(loadLocalState().queuedMessages["draft-1"]).toBeUndefined()
    expect(loadLocalState().queuedMessages["chat-1"]).toEqual([first])
    clearAllStorage()
    expect(loadLocalState().queuedMessages).toEqual({})
  })

  it("surfaces a blocked device write so the caller can keep the prompt in memory and warn", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, key: () => null, length: 0,
      setItem: () => { throw new Error("Storage quota exceeded") } })
    expect(() => setQueuedMessages("chat", [first], [])).toThrow("Storage quota exceeded")
    expect(loadLocalState().queuedMessages).toEqual({})
  })
})
