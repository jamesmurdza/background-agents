import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ChatMessageList } from "./ChatMessageList"

function renderWarning(uncommittedFilesCount: number, isNewRepo = false, overrides: Partial<Chat> = {}) {
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
    ...overrides,
  } as Chat
  return renderToStaticMarkup(createElement(ChatMessageList, {
    chat,
    isMobile: false,
    isRunning: chat.status === "running" || !!chat.queuedMessages?.length,
    isCreating: chat.status === "creating",
    isNewRepo,
    git: {} as GitContextValue,
    onSendMessage: () => {},
    onReload: () => {},
    onResumeQueue: () => {},
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

describe("chat execution presentation", () => {
  it("does not claim a prompt was unsent when the acknowledgement is missing", () => {
    const html = renderWarning(0, false, { queuedMessages: [{ id: "ambiguous", content: "Keep this prompt",
      pendingSync: true, syncError: "HTTP 503", syncFailed: false }] })
    expect(html).toContain("Send status unconfirmed: ")
    expect(html).not.toContain("Not sent:")
    expect(html).toContain("Keep this prompt")
    expect(html).not.toContain("animate-pulse")
  })
  it("explains a confirmed provider timeout after refresh without exposing raw logs", () => {
    const html = renderWarning(0, false, { status: "error", messages: [
      { id: "user", role: "user", content: "Please reply", timestamp: 1 },
      { id: "reply", role: "assistant", content: "", timestamp: 2, metadata: { turnFinalization: {
        state: "error", executionStopped: true, assistantMessageId: "reply", backgroundSessionId: "run",
        reason: "ProviderHeaderTimeoutError: Provider response headers timed out after 300000ms secret-log",
      } } },
    ] })
    expect(html).toContain("The model provider did not respond in time.")
    expect(html).not.toContain("secret-log")
    expect(html).toContain(">Retry</button>")
  })
  it("keeps partial provider output and offers Reload rather than replaying it", () => {
    const html = renderWarning(0, false, { status: "error", messages: [
      { id: "user", role: "user", content: "Please reply", timestamp: 1 },
      { id: "reply", role: "assistant", content: "Already generated output", timestamp: 2, metadata: { turnFinalization: {
        state: "error", executionStopped: true, assistantMessageId: "reply", backgroundSessionId: "run",
        reason: "ProviderHeaderTimeoutError: Provider response headers timed out",
      } } },
    ] })
    expect(html).toContain("Already generated output")
    expect(html).toContain(">Reload</button>")
    expect(html).not.toContain(">Retry</button>")
  })
  it("shows one honest direct-send recovery notice without a retry, queue, or fake agent error", () => {
    const html = renderWarning(0, false, { status: "error", errorMessage: "Quota exceeded",
      directSendRecovery: [{ id: "u1", userMessageId: "u1", content: "Keep original", syncFailed: true,
        directSend: { assistantMessageId: "a1", timestamp: 1, attachmentNames: ["notes.txt"] } }],
    })
    expect(html.match(/data-testid="chat-error-banner"/g)).toHaveLength(1)
    expect(html).toContain("Send status is unconfirmed")
    expect(html).toContain("Keep original")
    expect(html).toContain("Attachments are not saved on this device")
    expect(html).toContain("Copy prompt")
    expect(html).toContain("Dismiss local copy")
    expect(html).not.toContain("The last run stopped")
    expect(html).not.toContain(">Retry</button>")
    expect(html).not.toContain('data-testid="prompt-queue"')
  })
  it("offers explicit continuation only for a server-confirmed terminal error", () => {
    const failed = { status: "error", recoverableAssistantMessageId: "failed-reply",
      queuedMessages: [{ id: "later", content: "Later prompt" }],
    } as Partial<Chat>
    expect(renderWarning(0, false, failed)).toContain(">Continue queued prompts</button>")
    expect(renderWarning(0, false, { ...failed, recoverableAssistantMessageId: undefined })).not.toContain("Continue queued prompts")
    expect(renderWarning(0, false, { ...failed, status: "disconnected" })).not.toContain("Continue queued prompts")
  })
  it("shows persisted failure without client-only error text and keeps later prompts waiting", () => {
    const html = renderWarning(0, false, { status: "error", queuePaused: false,
      messages: [{ id: "failed-user", role: "user", content: "First prompt", timestamp: 1 }],
      queuedMessages: [{ id: "later", content: "Later prompt", sendImmediately: true }],
    })
    expect(html).toContain('data-testid="chat-error-banner"')
    expect(html).toContain("The last run stopped before it finished.")
    expect(html).toContain(">Reload</button>")
    expect(html).toContain("Later prompt")
    expect(html).not.toContain("Starting")
    expect(html).not.toContain("animate-pulse")
  })
  it("shows one loader during startup without marking an old reply as streaming", () => {
    const html = renderWarning(0, false, {
      status: "creating",
      messages: [{ id: "old", role: "assistant", content: "Previous reply", timestamp: 1 }],
      queuedMessages: [{ id: "pending", content: "Next prompt" }],
    })
    expect(html.match(/animate-pulse/g)).toHaveLength(1)
  })

  it("renders the first idle submission as a message, not as waiting in the queue", () => {
    const html = renderWarning(0, false, {
      messages: [{ id: "old", role: "assistant", content: "Previous reply", timestamp: 1 }],
      queuedMessages: [{ id: "pending", content: "Next prompt", pendingSync: true }],
    })
    expect(html).toContain('data-testid="user-message"')
    expect(html).not.toContain("Saving to queue")
  })

  it("shows rejected submissions and pending removals without a running loader", () => {
    const failed = renderWarning(0, false, {
      queuedMessages: [{ id: "failed", content: "Rejected text", pendingSync: true, sendImmediately: true, syncError: "Invalid prompt", syncFailed: true }],
    })
    expect(failed).toContain("Not sent: ")
    expect(failed).toContain("Invalid prompt")
    expect(failed).not.toContain("Sending")
    expect(failed).not.toContain("animate-pulse")
    const removing = renderWarning(0, false, {
      queuedMessages: [{ id: "pending", content: "Remove this", pendingSync: true, cancelRequested: true, syncError: "Failed to fetch" }],
    })
    expect(removing).toContain("Removal pending confirmation")
    expect(removing).toContain("Could not confirm removal")
    expect(removing).not.toContain("animate-pulse")
  })
})
