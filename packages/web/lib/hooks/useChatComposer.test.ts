import { createElement, type KeyboardEvent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat, CredentialFlags, PendingFile } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

const mocks = vi.hoisted(() => ({
  pendingFiles: [] as PendingFile[],
  clearFiles: vi.fn(),
  draftChanged: vi.fn(),
  send: vi.fn(),
  enqueue: vi.fn(),
  resume: vi.fn(),
  toast: vi.fn(),
  showCreditDialog: vi.fn(),
  branch: vi.fn(),
  creditBalanceUsd: null as number | null,
  thinking: "default",
  thinkingReady: true,
  thinkingHook: vi.fn(),
  recheckThinking: vi.fn(),
  thinkingMenuOpen: vi.fn(),
}))

vi.mock("@/lib/contexts", () => ({
  useModals: () => ({ setSignInModalOpen: vi.fn() }),
  useGit: () => ({ canBranch: true, handleBranchWithMessage: mocks.branch }),
}))
// Composer contract tests use a resolved capability snapshot. Native discovery
// and interactive preference changes are covered separately in browser QA.
vi.mock("./useThinkingPreference", () => ({
  useThinkingPreference: (...args: unknown[]) => {
    mocks.thinkingHook(...args)
    return { thinking: mocks.thinking, setThinking: vi.fn(), capability: { levels: [] }, ready: mocks.thinkingReady,
      checking: false, canRecheck: true, recheckThinking: mocks.recheckThinking, onThinkingMenuOpen: mocks.thinkingMenuOpen }
  },
}))
vi.mock("@/lib/query/hooks/useSettingsQuery", () => ({
  useSettingsQuery: () => ({ data: { customEndpoints: [], creditBalanceUsd: mocks.creditBalanceUsd } }),
}))
vi.mock("@/lib/hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    pendingFiles: mocks.pendingFiles,
    clearFiles: mocks.clearFiles,
    previewFile: null,
    fileContents: new Map(),
    fileInputRef: { current: null },
    removeFile: vi.fn(),
    setPreviewFile: vi.fn(),
  }),
}))
vi.mock("@/lib/stores/toast-store", () => ({
  useToastStore: { getState: () => ({ addToast: mocks.toast }) },
}))

import { useChatComposer } from "./useChatComposer"

type Composer = ReturnType<typeof useChatComposer>

// A real React render evaluates the hook; controlled state snapshots isolate
// the send contract without pretending to test network or browser transitions.
function renderComposer(overrides: Partial<Chat> = {}, draft = "Keep this draft", credentialFlags: CredentialFlags = {}) {
  const chat = {
    id: "chat-1", repo: "__new__", baseBranch: "main", branch: null,
    sandboxId: "sandbox-1", sessionId: null, displayName: "Test",
    agent: "opencode", model: "opencode/big-pickle",
    messages: [{ id: "previous", role: "assistant", content: "Previous reply", timestamp: 1 }],
    createdAt: 0, updatedAt: 1, status: "ready", ...overrides,
  } as Chat
  let result: Composer | undefined
  function Probe() {
    result = useChatComposer({
      chat, settings: DEFAULT_SETTINGS, credentialFlags, draft,
      onDraftChange: mocks.draftChanged,
      isMobile: false, isSending: false, isAuthenticated: true,
      onSendMessage: mocks.send, onEnqueueMessage: mocks.enqueue, onResumeQueue: mocks.resume,
      showCreditDialog: mocks.showCreditDialog,
    })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result!
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pendingFiles = []
  mocks.creditBalanceUsd = null
  mocks.thinking = "default"
  mocks.thinkingReady = true
})

describe("composer thinking selection", () => {
  it("passes turn startup hints and explicit discovery actions without claiming sandbox lifecycle state", () => {
    const first = renderComposer({ status: "ready", backgroundSessionId: undefined })
    renderComposer({ status: "creating" })
    renderComposer({ status: "running", backgroundSessionId: "new-session" })
    expect(mocks.thinkingHook.mock.calls.map(call => call[4])).toEqual([
      { readinessKey: "ready:", isStarting: false },
      { readinessKey: "creating:", isStarting: true },
      { readinessKey: "running:new-session", isStarting: false },
    ])
    expect(first.recheckThinking).toBe(mocks.recheckThinking)
    expect(first.onThinkingMenuOpen).toBe(mocks.thinkingMenuOpen)
  })
  it("freezes the selected effort for an enqueued prompt", () => {
    mocks.thinking = "high"
    renderComposer().handleSend()
    expect(mocks.enqueue.mock.calls[0]).toContain("high")
    mocks.thinking = "low"
    expect(mocks.enqueue.mock.calls[0]).toContain("high")
  })
  it("keeps the draft while native capability discovery is pending", () => {
    mocks.thinkingReady = false
    const composer = renderComposer()
    expect(composer.canSend).toBe(false)
    composer.handleSend()
    composer.handleBranchSend()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.branch).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
  })
})

describe("composer credit gate", () => {
  it.each(["send", "enter", "branch"])("opens credit options on %s without losing the draft or attachments", (action) => {
    mocks.creditBalanceUsd = -0.01
    const file = new File(["file content"], "draft.txt", { type: "text/plain" })
    mocks.pendingFiles = [{ id: "file-1", file, name: file.name, size: file.size }]
    const composer = renderComposer({ agent: "claude-code", model: "sonnet" }, "Keep this draft", {
      CLAUDE_SHARED_POOL_AVAILABLE: true, SHARED_BALANCE_EXHAUSTED: true,
    })
    if (action === "enter") {
      composer.handleKeyDown({ key: "Enter", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>)
    } else if (action === "branch") {
      composer.handleBranchSend()
    } else {
      composer.handleSend()
    }
    expect(mocks.showCreditDialog).toHaveBeenCalledWith("claude", -0.01)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.branch).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
    expect(mocks.clearFiles).not.toHaveBeenCalled()
  })

  it.each(["free", "own key"])("allows %s usage with an empty balance", (route) => {
    mocks.creditBalanceUsd = 0
    const composer = renderComposer(route === "free" ? {} : { agent: "claude-code", model: "sonnet" }, "Keep this draft", {
      CLAUDE_SHARED_POOL_AVAILABLE: true, SHARED_BALANCE_EXHAUSTED: true,
      ...(route === "own key" ? { ANTHROPIC_API_KEY: true } : {}),
    })
    composer.handleSend()
    expect(mocks.showCreditDialog).not.toHaveBeenCalled()
    expect(mocks.enqueue).toHaveBeenCalledTimes(1)
  })
})

describe("composer submission while Stop is being confirmed", () => {
  it.each(["attachment", "plan", "plain text"])("retains %s until Stop and its reload settle", (kind) => {
    const file = new File(["file content"], "draft.txt", { type: "text/plain" })
    if (kind === "attachment") mocks.pendingFiles = [{ id: "file-1", file, name: file.name, size: file.size }]
    const composer = renderComposer({ stopPending: true, planModeEnabled: kind === "plan" })

    expect(composer.canSend).toBe(false)
    expect(composer.canQueue).toBe(false)
    composer.handleSend()
    composer.handleKeyDown({ key: "Enter", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>)

    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
    expect(mocks.clearFiles).not.toHaveBeenCalled()
  })

  it("does not resume a paused queue while Stop is pending", () => {
    const composer = renderComposer({ stopPending: true, queuePaused: true, queuedMessages: [{ id: "queued", content: "Later" }] }, "")
    composer.handleSend()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
  })

  it.each(["attachment", "plan"])("allows the preserved %s through the direct path after Stop settles", (kind) => {
    const file = new File(["file content"], "draft.txt", { type: "text/plain" })
    if (kind === "attachment") mocks.pendingFiles = [{ id: "file-1", file, name: file.name, size: file.size }]
    const composer = renderComposer({ stopPending: false, planModeEnabled: kind === "plan" })

    expect(composer.canSend).toBeTruthy()
    composer.handleSend()

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith("Keep this draft", composer.currentAgent, composer.currentModel,
      kind === "attachment" ? [file] : undefined, kind === "plan" ? true : undefined, "default")
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.draftChanged).toHaveBeenCalledTimes(1)
    expect(mocks.draftChanged).toHaveBeenCalledWith("")
    expect(mocks.clearFiles).toHaveBeenCalledTimes(1)
  })
})

describe("composer after a failed turn", () => {
  it.each(["ready", "running"] as const)("keeps a newer draft editable but does not send past an unconfirmed direct request while %s", (status) => {
    const composer = renderComposer({ status, directSendRecovery: [{ id: "pending", content: "Original", directSend: { assistantMessageId: "assistant", timestamp: 1 } }] }, "Newer draft")
    expect(composer.canSend).toBe(false)
    expect(composer.canQueue).toBe(false)
    composer.handleSend()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
  })
  it.each(["error", "disconnected"] as const)("does not present a %s chat with waiting prompts as running", (status) => {
    const composer = renderComposer({ status, queuePaused: false, backgroundSessionId: undefined,
      activeAssistantMessageId: undefined, queuedMessages: [{ id: "later", content: "Keep this queued" }] })

    expect(composer.isRunning).toBe(false)
    expect(composer.isCreating).toBe(false)
    expect(composer.canSend).toBe(false)
    expect(composer.canQueue).toBe(false)
    composer.handleSend()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
  })
})

describe("queued prompts preserve unsupported options", () => {
  it.each(["running", "paused"] as const)("keeps an attachment and its text instead of sending text alone while %s", (state) => {
    const file = new File(["File content"], "notes.txt", { type: "text/plain" })
    mocks.pendingFiles = [{ id: "file-1", file, name: file.name, size: file.size }]
    const composer = renderComposer({ status: state === "running" ? "running" : "ready",
      queuePaused: state === "paused", queuedMessages: [{ id: "older", content: "Earlier prompt" }] }, "Read the attached file")
    expect(composer.canSend).toBe(false)
    expect(composer.canQueue).toBe(false)
    composer.handleSend()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
    expect(mocks.clearFiles).not.toHaveBeenCalled()
  })

  it.each(["running", "paused"] as const)("does not silently discard Plan mode while %s", (state) => {
    const composer = renderComposer({ status: state === "running" ? "running" : "ready", planModeEnabled: true,
      queuePaused: state === "paused", queuedMessages: [{ id: "older", content: "Earlier prompt" }] })
    expect(composer.canSend).toBe(false)
    expect(composer.canQueue).toBe(false)
    composer.handleSend()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.draftChanged).not.toHaveBeenCalled()
  })

  it("allows explicitly resuming existing prompts with no new text or files even if Plan mode is selected", () => {
    const composer = renderComposer({ planModeEnabled: true, queuePaused: true,
      queuedMessages: [{ id: "older", content: "Earlier prompt" }] }, "")
    expect(composer.canSend).toBeTruthy()
    composer.handleSend()
    expect(mocks.resume).toHaveBeenCalledTimes(1)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it("still queues ordinary text after a pause", () => {
    const composer = renderComposer({ queuePaused: true, queuedMessages: [{ id: "older", content: "Earlier prompt" }] })
    expect(composer.canSend).toBeTruthy()
    composer.handleSend()
    expect(mocks.enqueue).toHaveBeenCalledWith("Keep this draft", composer.currentAgent, composer.currentModel, "default")
    expect(mocks.draftChanged).toHaveBeenCalledWith("")
  })
})
