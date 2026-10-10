import { describe, expect, it } from "vitest"
import { applyQueueSnapshot, needsQueueMessages, needsChatListMessages, queueSyncFailure } from "./queue-sync"
import { getPendingSubmission, mergeLocalState } from "./chat-state"
import type { Chat } from "./types"
import type { PromptQueueResponse } from "./sync/api"
import { ApiError } from "./sync/api"

const pending = { id: "queue-1", clientId: "client-1", userMessageId: "user-1", content: "same text", status: "dispatching" }
const chat = { id: "chat-1", status: "creating", updatedAt: 1, messages: [], queuedMessages: [pending] } as unknown as Chat
const remote = { status: "running", sandboxId: "sandbox", backgroundSessionId: "turn", activeAssistantMessageId: "assistant-1", queuePaused: false, queuedMessages: [], updatedAt: 2 } as PromptQueueResponse

describe("queue presentation across server transitions", () => {
  it("does not carry a recovery permission across a changed server revision", () => {
    const failed = { ...chat, status: "error", updatedAt: 2, recoverableAssistantMessageId: "failed" } as Chat
    const snapshot = { ...remote, status: "error", activeAssistantMessageId: null, backgroundSessionId: null } as PromptQueueResponse
    expect(applyQueueSnapshot(failed, snapshot).recoverableAssistantMessageId).toBe("failed")
    expect(applyQueueSnapshot(failed, { ...snapshot, updatedAt: 3 }).recoverableAssistantMessageId).toBeUndefined()
    expect(applyQueueSnapshot(failed, { ...snapshot, recoverableAssistantMessageId: null }).recoverableAssistantMessageId).toBeUndefined()
    expect(applyQueueSnapshot(failed, { ...snapshot, status: "ready" }).recoverableAssistantMessageId).toBeUndefined()
  })
  it("retains failure details only while reconciling the same failed turn", () => {
    const failed = { ...chat, status: "error", backgroundSessionId: undefined,
      activeAssistantMessageId: undefined, lastMessageId: "failed-reply", errorMessage: "Provider unavailable", errorKind: "crash" } as Chat
    const snapshot = { ...remote, status: "error", backgroundSessionId: null,
      activeAssistantMessageId: null, lastMessageId: "failed-reply" } as PromptQueueResponse
    expect(applyQueueSnapshot(failed, snapshot).errorMessage).toBe("Provider unavailable")
    expect(applyQueueSnapshot(failed, snapshot).errorKind).toBe("crash")
    expect(applyQueueSnapshot(failed, { ...snapshot, status: "ready" }).errorMessage).toBeUndefined()
    expect(applyQueueSnapshot(failed, { ...snapshot, lastMessageId: "another-reply" }).errorMessage).toBeUndefined()
    expect(applyQueueSnapshot(failed, { ...remote, lastMessageId: "new-reply" }).errorKind).toBeUndefined()
  })
  it("loads messages before dropping a queue item or adopting a new active turn", () => {
    expect(needsQueueMessages(chat, { ...remote, backgroundSessionId: "turn", activeAssistantMessageId: "assistant-1" })).toBe(true)
    expect(needsQueueMessages({ ...chat, backgroundSessionId: "old" }, { queuedMessages: [], backgroundSessionId: undefined })).toBe(true)
  })

  it("refreshes a ready observer after a complete turn ran while it was offline", () => {
    const observer = { ...chat, status: "ready", queuedMessages: [], messageCount: 2,
      messages: [{ id: "reply-old", role: "assistant", content: "old", timestamp: 1 }] } as Chat
    expect(needsQueueMessages(observer, { queuedMessages: [], messageCount: 4, lastMessageId: "reply-new" })).toBe(true)
    expect(needsQueueMessages(observer, { queuedMessages: [], messageCount: 2, lastMessageId: "reply-old" })).toBe(false)
  })

  it("does not eagerly load every unopened chat when refreshing the sidebar", () => {
    const unopened = { ...chat, status: "ready", messages: [], queuedMessages: [], messageCount: 100 } as Chat
    const server = { queuedMessages: [], messageCount: 102, lastMessageId: "new-last" }
    expect(needsChatListMessages(unopened, server)).toBe(false)
    expect(needsQueueMessages(unopened, server)).toBe(true)
    expect(needsChatListMessages({ ...unopened, messages: [{ id: "old", role: "user", content: "old", timestamp: 1 }] }, server)).toBe(true)
  })

  it("does not repeatedly load history merely because an unsaved prompt is failing", () => {
    const ready = { ...chat, status: "ready", queuedMessages: [], messageCount: 0 } as Chat
    const server = { queuedMessages: [], messageCount: 0 }
    expect(needsQueueMessages(ready, server, [{ id: "local", content: "not saved", syncFailed: true }])).toBe(false)
    expect(needsQueueMessages(ready, server, [{ id: "local", content: "saved", userMessageId: "user-saved" }])).toBe(true)
    expect(needsQueueMessages(ready, { ...server, queuedMessages: [{ id: "server", clientId: "local", content: "saved" }] },
      [{ id: "local", content: "saved", userMessageId: "user-saved" }])).toBe(false)
  })

  it("does not present rejected or cancelling local work as actively sending", () => {
    expect(getPendingSubmission({ ...chat, queuedMessages: [{ ...pending, syncError: "Invalid prompt", syncFailed: true }] })).toBeUndefined()
    expect(getPendingSubmission({ ...chat, queuedMessages: [{ ...pending, cancelRequested: true }] })).toBeUndefined()
  })

  it("keeps retryable failures distinct from permanently rejected requests", () => {
    for (const status of [400, 403, 404, 409, 413, 422]) {
      expect(queueSyncFailure(new ApiError("Rejected", status))).toEqual({ syncError: "Rejected", syncFailed: true })
    }
    for (const status of [401, 408, 429, 500, 502, 503]) {
      expect(queueSyncFailure(new ApiError("Try later", status)).syncFailed).toBe(false)
    }
    expect(queueSyncFailure(new TypeError("Failed to fetch")).syncFailed).toBe(false)
  })

  it("retains a local cancellation on the corresponding server queue row", () => {
    const local = { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {
      "chat-1": [{ ...pending, id: "client-1", pendingSync: true, cancelRequested: true }],
    } }
    const merged = mergeLocalState([chat], local)[0]
    expect(merged.queuedMessages).toHaveLength(1)
    expect(merged.queuedMessages?.[0].cancelRequested).toBe(true)
    expect(getPendingSubmission(merged)).toBeUndefined()
  })

  it("reconciles messages and queue together without repeating the submitted text", () => {
    const next = applyQueueSnapshot(chat, remote, {
      ...remote, messages: [{ id: "user-1", role: "user", content: "same text", timestamp: 1 }],
      queuedMessages: [pending], messageCount: 1,
    } as Parameters<typeof applyQueueSnapshot>[2])
    expect(next.messages).toHaveLength(1)
    expect(next.queuedMessages).toEqual([])
    const merged = mergeLocalState([next], { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {
      "chat-1": [{ ...pending, id: "client-1", pendingSync: true }],
    } })[0]
    expect(merged.queuedMessages).toEqual([])
  })

  it("does not let an older response replace a newer turn", () => {
    const newer = { ...chat, updatedAt: 3, backgroundSessionId: "newer" }
    expect(applyQueueSnapshot(newer, remote)).toBe(newer)
  })

  it("keeps the first direct send loading when a pre-send poll arrives", () => {
    const sending = { ...chat, queuedMessages: [], pendingSend: true, activeAssistantMessageId: "optimistic-assistant" }
    const next = applyQueueSnapshot(sending, { ...remote, status: "pending", backgroundSessionId: null, activeAssistantMessageId: null })
    expect(next.status).toBe("creating")
    expect(next.activeAssistantMessageId).toBe("optimistic-assistant")
    // Once the request resolves, ordinary server status wins again.
    expect(applyQueueSnapshot({ ...next, pendingSend: false }, { ...remote, status: "ready", activeAssistantMessageId: null }).status).toBe("ready")
  })

  it("does not collapse repeated text with distinct request identities", () => {
    const next = mergeLocalState([chat], { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {
      "chat-1": [{ id: "different", content: "same text" }],
    } })[0]
    expect(next.queuedMessages).toHaveLength(2)
  })

  it("shows only the starting item as a submission, keeping paused and later items waiting", () => {
    expect(getPendingSubmission(chat)).toBe(pending)
    expect(getPendingSubmission({ ...chat, queuePaused: true })).toBeUndefined()
    expect(getPendingSubmission({ ...chat, status: "running", queuedMessages: [{ ...pending, status: "queued" }] })).toBeUndefined()
  })
})
