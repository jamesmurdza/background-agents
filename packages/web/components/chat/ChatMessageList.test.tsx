import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ChatMessageList } from "./ChatMessageList"

function renderWarning(hasUncommittedFiles: boolean, isNewRepo = false) {
  const chat = {
    id: "chat-1",
    repo: isNewRepo ? "__new__" : "owner/repo",
    baseBranch: "main",
    branch: "fix/example",
    sandboxId: null,
    sessionId: null,
    displayName: "Example",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    status: "ready",
    hasUncommittedFiles,
  } as Chat
  return renderToStaticMarkup(createElement(ChatMessageList, {
    chat,
    isMobile: false,
    isRunning: false,
    isCreating: false,
    isNewRepo,
    git: {} as GitContextValue,
    onSendMessage: () => {},
    currentAgent: "opencode" as Agent,
    currentModel: "test",
    planModeEnabled: false,
    messagesContainerRef: createRef<HTMLDivElement>(),
    messagesEndRef: createRef<HTMLDivElement>(),
    onScroll: () => {},
    userHasScrolledUp: false,
    onScrollToBottom: () => {},
  }))
}

describe("uncommitted file warning", () => {
  it("appears in a GitHub chat with new uncommitted files", () => {
    const html = renderWarning(true)
    expect(html).toContain('data-testid="uncommitted-files-warning"')
    expect(html).toContain("Ask the agent to review and commit")
  })

  it("disappears when the authoritative chat flag clears", () => {
    expect(renderWarning(false)).not.toContain("uncommitted-files-warning")
    expect(renderWarning(true, true)).not.toContain("uncommitted-files-warning")
  })
})
