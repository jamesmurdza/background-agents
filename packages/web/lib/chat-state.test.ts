import { describe, it, expect } from "vitest"
import type { Chat, ChatStatus, QueuedMessage } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  mergeLocalState,
  migrateLocalChatState,
  computeUnseenTransitions,
  enqueue,
  removeFromQueue,
  dequeue,
  isChatReadyForQueueDispatch,
  upsertDraft,
  type LocalChatState,
} from "@/lib/chat-state"

// Minimal Chat fixture — only the fields these pure transforms touch matter.
function chat(overrides: Partial<Chat> & { id: string }): Chat {
  return {
    repo: NEW_REPOSITORY,
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    status: "ready" as ChatStatus,
    displayName: null,
    ...overrides,
  } as Chat
}

function emptyLocal(): LocalChatState {
  return { previewStates: {}, queuedMessages: {}, queuePaused: {}, drafts: {} }
}

function q(id: string): QueuedMessage {
  return { id, content: `msg-${id}` }
}

describe("mergeLocalState", () => {
  it("layers queued messages and queue-paused flag onto matching chats", () => {
    const local = emptyLocal()
    local.queuedMessages["a"] = [q("1")]
    local.queuePaused["a"] = true

    const [merged] = mergeLocalState([chat({ id: "a" })], local)

    expect(merged.queuedMessages).toEqual([q("1")])
    expect(merged.queuePaused).toBe(true)
  })

  it("layers preview state fields onto matching chats", () => {
    const local = emptyLocal()
    local.previewStates["a"] = { items: [{ type: "terminal", id: "t1" }], activeIndex: 0, hidden: false }

    const [merged] = mergeLocalState([chat({ id: "a" })], local)

    expect(merged.previewItems).toEqual([{ type: "terminal", id: "t1" }])
    expect(merged.activePreviewIndex).toBe(0)
    expect(merged.previewPaneHidden).toBe(false)
  })

  it("leaves chats without local state with undefined overlays", () => {
    const [merged] = mergeLocalState([chat({ id: "b" })], emptyLocal())
    expect(merged.queuedMessages).toBeUndefined()
    expect(merged.previewItems).toBeUndefined()
  })

  it("does not mutate the input chats", () => {
    const input = chat({ id: "a" })
    mergeLocalState([input], emptyLocal())
    expect(input).not.toHaveProperty("queuedMessages")
  })
})

describe("migrateLocalChatState", () => {
  it("moves all four maps from the draft id to the real id", () => {
    const prev: LocalChatState = {
      previewStates: { draft: { items: [], activeIndex: 0, hidden: true } },
      queuedMessages: { draft: [q("1")] },
      queuePaused: { draft: false },
      drafts: { draft: "hello" },
    }

    const next = migrateLocalChatState(prev, "draft", "real")

    expect(next.previewStates).toEqual({ real: { items: [], activeIndex: 0, hidden: true } })
    expect(next.queuedMessages).toEqual({ real: [q("1")] })
    expect(next.queuePaused).toEqual({ real: false })
    expect(next.drafts).toEqual({ real: "hello" })
  })

  it("leaves unrelated ids untouched and is immutable", () => {
    const prev: LocalChatState = {
      previewStates: {},
      queuedMessages: { other: [q("1")], draft: [q("2")] },
      queuePaused: {},
      drafts: {},
    }

    const next = migrateLocalChatState(prev, "draft", "real")

    expect(next.queuedMessages).toEqual({ other: [q("1")], real: [q("2")] })
    expect(prev.queuedMessages).toEqual({ other: [q("1")], draft: [q("2")] }) // input unchanged
  })

  it("handles a draft with no local state", () => {
    expect(migrateLocalChatState(emptyLocal(), "draft", "real")).toEqual(emptyLocal())
  })
})

describe("computeUnseenTransitions", () => {
  it("marks a chat unseen when it goes running → non-running and is not open", () => {
    const prev = new Map<string, ChatStatus>([["a", "running"]])
    const { newlyUnseen } = computeUnseenTransitions([chat({ id: "a", status: "ready" })], prev, null)
    expect(newlyUnseen).toEqual(["a"])
  })

  it("does not mark the currently-open chat unseen", () => {
    const prev = new Map<string, ChatStatus>([["a", "running"]])
    const { newlyUnseen } = computeUnseenTransitions([chat({ id: "a", status: "ready" })], prev, "a")
    expect(newlyUnseen).toEqual([])
  })

  it("does not mark a still-running chat", () => {
    const prev = new Map<string, ChatStatus>([["a", "running"]])
    const { newlyUnseen } = computeUnseenTransitions([chat({ id: "a", status: "running" })], prev, null)
    expect(newlyUnseen).toEqual([])
  })

  it("returns a next-status map containing only current chats (prunes stale ids)", () => {
    const prev = new Map<string, ChatStatus>([["gone", "running"], ["a", "running"]])
    const { nextStatuses } = computeUnseenTransitions([chat({ id: "a", status: "ready" })], prev, null)
    expect(Array.from(nextStatuses.keys())).toEqual(["a"])
    expect(nextStatuses.get("a")).toBe("ready")
  })
})

describe("queue operations", () => {
  it("enqueue appends, treating undefined as empty", () => {
    expect(enqueue(undefined, q("1"))).toEqual([q("1")])
    expect(enqueue([q("1")], q("2"))).toEqual([q("1"), q("2")])
  })

  it("removeFromQueue removes by id and tolerates undefined", () => {
    expect(removeFromQueue([q("1"), q("2")], "1")).toEqual([q("2")])
    expect(removeFromQueue(undefined, "1")).toEqual([])
  })

  it("dequeue splits head from rest", () => {
    expect(dequeue([q("1"), q("2"), q("3")])).toEqual({ next: q("1"), rest: [q("2"), q("3")] })
  })
})

describe("isChatReadyForQueueDispatch", () => {
  const ready = { status: "ready" as ChatStatus, backgroundSessionId: undefined }

  it("is false for an empty or undefined queue", () => {
    expect(isChatReadyForQueueDispatch(ready, [], false)).toBe(false)
    expect(isChatReadyForQueueDispatch(ready, undefined, false)).toBe(false)
  })

  it("is false when paused", () => {
    expect(isChatReadyForQueueDispatch(ready, [q("1")], true)).toBe(false)
  })

  it("is false when the chat is not ready or still has a background session", () => {
    expect(isChatReadyForQueueDispatch({ status: "running", backgroundSessionId: undefined }, [q("1")], false)).toBe(false)
    expect(isChatReadyForQueueDispatch({ status: "ready", backgroundSessionId: "bg1" }, [q("1")], false)).toBe(false)
  })

  it("is true for a ready, unpaused chat with a non-empty queue", () => {
    expect(isChatReadyForQueueDispatch(ready, [q("1")], false)).toBe(true)
  })
})

describe("upsertDraft", () => {
  it("sets a draft", () => {
    expect(upsertDraft({}, "a", "hi")).toEqual({ a: "hi" })
  })

  it("overwrites an existing draft", () => {
    expect(upsertDraft({ a: "old" }, "a", "new")).toEqual({ a: "new" })
  })

  it("removes the entry for an empty string or undefined", () => {
    expect(upsertDraft({ a: "hi" }, "a", "")).toEqual({})
    expect(upsertDraft({ a: "hi" }, "a", undefined)).toEqual({})
  })

  it("does not mutate the input", () => {
    const input = { a: "hi" }
    upsertDraft(input, "a", "bye")
    expect(input).toEqual({ a: "hi" })
  })
})
