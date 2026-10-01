import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ChatMessageList } from "./ChatMessageList"

function renderWarning(uncommittedFilesCount: number, isNewRepo = false, onCreateRepo?: () => void) {
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
    uncommittedFilesCount,
  } as Chat
  return renderToStaticMarkup(createElement(ChatMessageList, {
    chat,
    isMobile: false,
    isRunning: false,
    isCreating: false,
    isNewRepo,
    git: {} as GitContextValue,
    onSendMessage: () => {},
    onCreateRepo,
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
    const html = renderWarning(2)
    expect(html).toContain('data-testid="uncommitted-files-warning"')
    expect(html).toContain("You have 2 new uncommitted files")
    expect(html).toContain("Commit your changes")
  })

  it("singularizes the count when there is exactly one file", () => {
    const html = renderWarning(1)
    expect(html).toContain("You have 1 new uncommitted file.")
  })

  it("disappears when the authoritative chat count clears", () => {
    expect(renderWarning(0)).not.toContain("uncommitted-files-warning")
    expect(renderWarning(2, true)).not.toContain("uncommitted-files-warning")
  })
})

describe("no-repo warning", () => {
  it("appears instead of the commit banner when the chat has no GitHub repo connected", () => {
    const html = renderWarning(2, true)
    expect(html).toContain('data-testid="no-repo-warning"')
    expect(html).toContain("You are not working in a GitHub repository")
    expect(html).toContain("Create a repository")
    expect(html).not.toContain("uncommitted-files-warning")
  })

  it("does not appear for a connected repo, even with uncommitted files", () => {
    expect(renderWarning(2, false)).not.toContain("no-repo-warning")
  })

  it("does not appear when there are no uncommitted files, even with no repo connected", () => {
    expect(renderWarning(0, true)).not.toContain("no-repo-warning")
  })
})
