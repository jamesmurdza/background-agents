import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Chat } from "@/lib/types"
import { ChatItem } from "./ChatItem"
import { MobileChatItem } from "./MobileChatItem"

function renderSidebar(mobile: boolean, overrides: Partial<Chat>) {
  const chat = { id: "chat", status: "ready", messages: [], queuedMessages: [{ id: "next", content: "Next prompt" }], ...overrides } as Chat
  const props = { chat, isActive: true, isDeleting: false, isUnseen: false, onSelect() {}, onDelete() {} }
  return renderToStaticMarkup(mobile
    ? createElement(MobileChatItem, { ...props, onRequestRename() {} })
    : createElement(ChatItem, { ...props, collapsed: false, onRename() {} }))
}

describe.each([false, true])("sidebar work indicator (mobile=%s)", (mobile) => {
  it.each(["error", "disconnected"] as const)("does not spin for %s with waiting prompts", (status) => {
    expect(renderSidebar(mobile, { status })).not.toContain("animate-spin")
  })
  it("does not spin for a paused queue", () => {
    expect(renderSidebar(mobile, { status: "ready", queuePaused: true })).not.toContain("animate-spin")
  })
  it.each([{ syncError: "Not sent" }, { syncFailed: true }, { cancelRequested: true }, { lastError: "Failed to start" }])("does not spin for blocked queue entries (%s)", (flags) => {
    expect(renderSidebar(mobile, { queuedMessages: [{ id: "blocked", content: "Not running", ...flags }] })).not.toContain("animate-spin")
  })
  it.each(["running", "creating", "ready"] as const)("still spins for %s active/dispatchable work", (status) => {
    expect(renderSidebar(mobile, { status })).toContain("animate-spin")
  })
})
