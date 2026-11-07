import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ChatMessageList } from "./ChatMessageList"

function renderWarning(uncommittedFilesCount: number, isNewRepo = false, overrides: Partial<Chat> = {}, git: Partial<GitContextValue> = {}) {
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
    git: git as GitContextValue,
    onSendMessage: () => {},
    onOpenChanges: () => {},
    onCreateRepo: () => {},
    onReload: () => {},
    onResumeQueue: () => {},
    onChooseModel: () => {},
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
  it("appears in a GitHub chat with uncommitted files", () => {
    const html = renderWarning(2)
    expect(html).toContain('data-testid="uncommitted-files-warning"')
    expect(html).toContain("You have 2 uncommitted files")
    expect(html).toContain(">Review</button>")
    expect(html).toContain(">commit</button> them.")
  })

  it("singularizes the count when there is exactly one file", () => {
    const html = renderWarning(1)
    expect(html).toContain("You have 1 uncommitted file.")
    expect(html).toContain(">commit</button> it.")
  })

  it("disappears when the authoritative chat count clears", () => {
    expect(renderWarning(0)).not.toContain("uncommitted-files-warning")
    expect(renderWarning(0, true)).not.toContain("uncommitted-files-warning")
  })

  it("offers to create a repo instead of committing when there is no linked repo", () => {
    const html = renderWarning(2, true)
    expect(html).toContain('data-testid="uncommitted-files-warning"')
    expect(html).toContain("You have 2 uncommitted files with nowhere to back them up.")
    expect(html).toContain('data-testid="uncommitted-files-create-repo"')
    expect(html).toContain(">Create a repo</button> to save your work.")
    expect(html).not.toContain(">commit</button>")
  })

  it("singularizes the no-repo copy when there is exactly one file", () => {
    const html = renderWarning(1, true)
    expect(html).toContain("You have 1 uncommitted file with nowhere to back it up.")
  })
})

describe("force-push failure banner", () => {
  const forcePushMessage = {
    id: "push-fail", role: "assistant" as const, content: "Push failed: non-fast-forward. You can force push to overwrite the remote history.",
    timestamp: 1, messageType: "git-operation" as const, isError: true, metadata: { action: "force-push" as const },
  }

  it("shows a banner with a force-push action instead of the inline git-operation message", () => {
    const html = renderWarning(0, false, { messages: [forcePushMessage] })
    expect(html).toContain('data-testid="chat-error-banner"')
    expect(html).toContain("Push failed: non-fast-forward.")
    expect(html).not.toContain("You can force push to overwrite the remote history.")
    expect(html).toContain(">Force push</button>")
    // Not also rendered inline as a normal assistant message.
    expect(html).not.toContain('data-message-id="push-fail"')
  })
})

describe("conflict banner", () => {
  it("shows a merge-conflict banner with resolve and abort actions", () => {
    const html = renderWarning(0, false, {}, {
      rebaseConflict: { inRebase: false, inMerge: true, conflictedFiles: ["a.ts", "b.ts"] },
    })
    expect(html).toContain('data-testid="conflict-warning"')
    expect(html).toContain("A merge conflict is in progress (2 files).")
    expect(html).toContain(">Resolve</button>")
    expect(html).toContain(">abort</button>")
  })

  it("labels a rebase conflict distinctly and singularizes a single file", () => {
    const html = renderWarning(0, false, {}, {
      rebaseConflict: { inRebase: true, inMerge: false, conflictedFiles: ["a.ts"] },
    })
    expect(html).toContain("A rebase conflict is in progress (1 file).")
  })

  it("hides when there is no conflict in progress", () => {
    const html = renderWarning(0, false, {}, {
      rebaseConflict: { inRebase: false, inMerge: false, conflictedFiles: [] },
    })
    expect(html).not.toContain('data-testid="conflict-warning"')
  })
})

describe("chat execution presentation", () => {
  it.each([false, true])("offers model selection without replaying an unsupported turn (persisted=%s)", persisted => {
    const reason = "400 invalid_request_error: The model is not supported. private-provider-detail"
    const html = renderWarning(0, false, { status: "error", errorMessage: persisted ? undefined : reason,
      messages: [
        { id: "user", role: "user", content: "Keep my prompt", timestamp: 1 },
        { id: "reply", role: "assistant", content: "", timestamp: 2, ...(persisted ? { metadata: { turnFinalization: {
          state: "error", executionStopped: true, assistantMessageId: "reply", backgroundSessionId: "run", reason,
        } } } : {}) },
      ],
      queuedMessages: [{ id: "next", content: "Wait for me" }],
      recoverableAssistantMessageId: "reply",
    })
    expect(html).toContain("This model is not supported in this session.")
    expect(html).toContain(">Choose model</button>")
    expect(html).toContain("Keep my prompt")
    expect(html).toContain("Wait for me")
    expect(html).not.toContain("private-provider-detail")
    expect(html).not.toContain(">Retry</button>")
    expect(html).not.toContain(">Continue queued prompts</button>")
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
  it.each(["", "partial answer"])("uses the failed assistant output, not the cron notice, to choose recovery for %j", content => {
    const html = renderWarning(0, false, { status: "error", messages: [
      { id: "user", role: "user", content: "Please reply", timestamp: 1 },
      { id: "reply", role: "assistant", content, timestamp: 2, metadata: { turnFinalization: {
        state: "error", executionStopped: true, assistantMessageId: "reply", backgroundSessionId: "run",
        reason: "ProviderModelNotFoundError: model is not available",
      } } },
      { id: "reply:error", role: "assistant", content: "Agent stopped", timestamp: 3, isError: true },
    ] })
    expect(html).toContain("This model is no longer available. Choose another model before retrying.")
    expect(html).toContain(content ? ">Reload</button>" : ">Retry</button>")
    expect(html).not.toContain("The last run stopped before it finished.")
  })
  it.each(["", "partial answer"])("offers Reload for a stopped run only when it saved output (%j)", content => {
    const html = renderWarning(0, false, { status: "error", messages: [
      { id: "user", role: "user", content: "Please reply", timestamp: 1 },
      { id: "reply", role: "assistant", content, timestamp: 2 },
      { id: "reply:error", role: "assistant", content: "Agent stopped: process exited", timestamp: 3, isError: true },
    ] })
    expect(html).toContain("The last run stopped before it finished.")
    expect(html).toContain(content ? ">Reload</button>" : ">Retry</button>")
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

  it.each([true, false])("renders an idle submission with one loader and no extra progress label (pendingSync=%s)", (pendingSync) => {
    const html = renderWarning(0, false, {
      messages: [{ id: "old", role: "assistant", content: "Previous reply", timestamp: 1 }],
      queuedMessages: [{ id: "pending", content: "Next prompt", pendingSync }],
    })
    expect(html).toContain('data-testid="user-message"')
    expect(html).not.toContain("Saving to queue")
    expect(html.match(/data-testid="user-message"/g)).toHaveLength(1)
    expect(html.match(/animate-pulse/g)).toHaveLength(1)
    expect(html).not.toContain("Sending…")
    expect(html).not.toContain("Starting…")
  })
})
