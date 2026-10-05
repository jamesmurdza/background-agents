import { createElement, type KeyboardEvent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat, PendingFile } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

const mocks = vi.hoisted(() => ({
  pendingFiles: [] as PendingFile[],
  clearFiles: vi.fn(),
  draftChanged: vi.fn(),
  send: vi.fn(),
  enqueue: vi.fn(),
  resume: vi.fn(),
  toast: vi.fn(),
}))

vi.mock("@/lib/contexts", () => ({
  useModals: () => ({ setSignInModalOpen: vi.fn() }),
  useGit: () => ({}),
}))
vi.mock("@/lib/query/hooks/useSettingsQuery", () => ({
  useSettingsQuery: () => ({ data: { customEndpoints: [] } }),
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
function renderComposer(overrides: Partial<Chat> = {}, draft = "Keep this draft") {
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
      chat, settings: DEFAULT_SETTINGS, credentialFlags: {}, draft,
      onDraftChange: mocks.draftChanged,
      isMobile: false, isSending: false, isAuthenticated: true,
      onSendMessage: mocks.send, onEnqueueMessage: mocks.enqueue, onResumeQueue: mocks.resume,
    })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result!
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pendingFiles = []
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
      kind === "attachment" ? [file] : undefined, kind === "plan" ? true : undefined)
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
    expect(mocks.enqueue).toHaveBeenCalledWith("Keep this draft", composer.currentAgent, composer.currentModel)
    expect(mocks.draftChanged).toHaveBeenCalledWith("")
  })
})
