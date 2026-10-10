import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acknowledgeDirectSends, dismissDirectSend, markDirectSendUnconfirmed, retainDirectSend } from "./direct-send-recovery"
import { loadLocalState } from "./storage"
import { useChatSyncStore } from "./stores/chat-sync-store"
import { getPendingSubmission, hasActiveQueue, mergeLocalState } from "./chat-state"
import type { Chat, QueuedMessage } from "./types"

const intent: QueuedMessage = { id: "user-1", userMessageId: "user-1", content: "Original prompt", syncFailed: true,
  directSend: { assistantMessageId: "assistant-1", timestamp: 1, attachmentNames: ["notes.txt"] } }
beforeEach(() => {
  const stored = new Map<string, string>()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size },
  })
  useChatSyncStore.setState({ localChatState: { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {} } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe("direct send retention is not a retry queue", () => {
  it("retains text and attachment names across hydration without changing a newer draft", () => {
    retainDirectSend("chat", intent)
    useChatSyncStore.getState().setDraftText("chat", "Newer draft")
    markDirectSendUnconfirmed("chat", intent.id, "Gateway did not respond")
    useChatSyncStore.getState().hydrate()
    const state = useChatSyncStore.getState().localChatState
    expect(state.drafts.chat).toBe("Newer draft")
    expect(state.queuedMessages.chat?.[0]).toMatchObject({ content: "Original prompt", directSend: { error: "Gateway did not respond", attachmentNames: ["notes.txt"] } })
  })
  it("does not acknowledge a missing or unrelated server message", () => {
    retainDirectSend("chat", intent)
    acknowledgeDirectSends("chat", [])
    acknowledgeDirectSends("chat", [{ id: "user-1", role: "assistant" }, { id: "other-user", role: "user" }])
    expect(loadLocalState().queuedMessages.chat).toHaveLength(1)
    acknowledgeDirectSends("chat", [{ id: "user-1", role: "user" }])
    expect(loadLocalState().queuedMessages.chat ?? []).toHaveLength(0)
  })
  it("keeps recovery distinct from waiting work and its loading indicators", () => {
    retainDirectSend("chat", intent)
    const chat = { id: "chat", status: "error", messages: [] } as unknown as Chat
    const merged = mergeLocalState([chat], useChatSyncStore.getState().localChatState)[0]
    expect(merged.queuedMessages).toEqual([])
    expect(merged.directSendRecovery).toEqual([intent])
    expect(hasActiveQueue({ status: "ready", queuedMessages: [intent] })).toBe(false)
    expect(getPendingSubmission({ ...chat, status: "ready", queuedMessages: [intent] })).toBeUndefined()
  })
  it("dismisses only the chosen local direct copy, without a fetch or deleting queued work", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    retainDirectSend("chat", { id: "queued", content: "Other pending prompt" })
    retainDirectSend("chat", intent)
    dismissDirectSend("chat", intent.id)
    expect(loadLocalState().queuedMessages.chat?.map((item) => item.id)).toEqual(["queued"])
    expect(fetch).not.toHaveBeenCalled()
  })
  it("reports failed durable storage while retaining text in memory", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded") })
    expect(retainDirectSend("chat", intent)).toBe(false)
    expect(useChatSyncStore.getState().localChatState.queuedMessages.chat).toEqual([intent])
  })
})
