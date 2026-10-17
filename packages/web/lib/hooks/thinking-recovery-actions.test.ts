import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"

const mocks = vi.hoisted(() => ({
  send: vi.fn(), setState: vi.fn(), closeLimit: vi.fn(),
  store: {} as Record<string, unknown>, chats: [] as Chat[],
  states: [] as unknown[], stateIndex: 0,
  refs: [] as Array<{ current: unknown }>, refIndex: 0,
}))

// These are controlled action-contract tests. Hooks use supplied snapshots;
// they do not claim to exercise browser transitions or a provider.
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => {
    const index = mocks.refIndex++
    return mocks.refs[index] ??= { current }
  },
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++
    const value = index in mocks.states ? mocks.states[index] : initial
    return [value, (next: unknown) => { mocks.states[index] = next; mocks.setState(next) }]
  },
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: {}, status: "authenticated" }) }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }))
vi.mock("@/lib/query", () => ({
  useChatsQuery: () => ({ data: mocks.chats }), useSettingsQuery: () => ({ data: { settings: {}, credentialFlags: {} } }),
  useCreateChatMutation: () => ({}), useUpdateSettingsMutation: () => ({}), useSuggestNameMutation: () => ({}),
}))
vi.mock("@/lib/stores/chat-sync-store", () => ({
  useChatSyncStore: Object.assign((select: (state: Record<string, unknown>) => unknown) => select(mocks.store), { getState: () => mocks.store }),
}))
vi.mock("./useStreaming", () => ({ useStreaming: () => ({ startStreaming: vi.fn(), updateChatsCache: vi.fn() }) }))
vi.mock("./useChatMessageSync", () => ({ useChatMessageSync: () => ({}) }))
vi.mock("./useChatOperations", () => ({ useChatOperations: () => ({}) }))
vi.mock("./useMessageDispatch", () => ({ useMessageDispatch: () => ({ sendMessage: mocks.send }) }))
vi.mock("@/components/MessageBubble", () => ({ MessageBubble: () => null }))

import { ChatMessageList } from "@/components/chat/ChatMessageList"
import { ErrorBanner } from "@/components/chat/ErrorBanner"
import { ThinkingRecoveryDialog } from "@/components/chat/ThinkingRecoveryDialog"
import { useChatWithSync } from "./useChatWithSync"
import type { ThinkingRecoveryRequest } from "@/lib/thinking-recovery"

const chat = (): Chat => ({
  id: "chat", repo: "__new__", baseBranch: "main", branch: null,
  sandboxId: "sandbox", sessionId: null, displayName: null,
  createdAt: 1, updatedAt: 2, status: "error", errorMessage: "Temporary launch failure",
  agent: "codex", model: "gpt-6.1-sol",
  messages: [{ id: "user", role: "user", content: "Keep this prompt", timestamp: 1,
    agent: "codex", model: "gpt-6.1-sol", metadata: { thinking: "ultra" } }],
})

function findElement(value: unknown, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) { const found = findElement(entry, type); if (found) return found }
  } else if (value && typeof value === "object" && "props" in value) {
    const element = value as ReactElement<Record<string, unknown>>
    if (element.type === type) return element
    return findElement(element.props.children, type)
  }
}

function renderList(currentModel = "gpt-6-luna", value = chat()) {
  mocks.stateIndex = mocks.refIndex = 0
  return ChatMessageList({
    chat: value, isMobile: false, isRunning: false, isCreating: false, isNewRepo: false,
    git: { canBranch: false } as GitContextValue,
    onSendMessage: mocks.send, currentAgent: "codex", currentModel, planModeEnabled: true,
    messagesContainerRef: { current: null }, messagesEndRef: { current: null },
    onScroll: vi.fn(), userHasScrolledUp: false, onScrollToBottom: vi.fn(),
  })
}

function retryList(currentModel = "gpt-6-luna", value = chat()) {
  const banner = findElement(renderList(currentModel, value), ErrorBanner)
  expect(banner).toBeDefined()
  ;(banner!.props.onRetry as () => void)()
}

function renderSync() {
  mocks.stateIndex = mocks.refIndex = 0
  return useChatWithSync()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({ status: "accepted" })
  mocks.states = []; mocks.refs = []; mocks.stateIndex = mocks.refIndex = 0
  mocks.chats = [chat()]
  mocks.store = {
    currentChatId: "chat", isHydrated: true, unseenChatIds: new Set(), deletingChatIds: new Set(),
    localChatState: { previewStates: {}, drafts: {}, queuedMessages: {} },
    limitReachedState: { show: false }, setLimitReachedState: mocks.closeLimit,
  }
})

describe("thinking recovery actions", () => {
  it("requires confirmation rather than combining Luna with the original Sol Ultra", () => {
    retryList()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.setState).toHaveBeenCalled()
  })

  it("keeps the original thinking when retrying the exact same agent and model", () => {
    retryList("gpt-6.1-sol")
    expect(mocks.send).toHaveBeenCalledWith("Keep this prompt", "codex", "gpt-6.1-sol", undefined, true, "ultra")
  })

  it("requires confirmation when historical message origin is unknown", () => {
    const value = chat()
    value.messages[0].agent = undefined
    value.messages[0].model = undefined
    retryList("gpt-6.1-sol", value)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("stages free-model fallback without resending the old Gemini token budget", () => {
    const pending = { chatId: "chat", content: "Keep this prompt", agent: "gemini", model: "gemini-2.5-pro",
      thinking: "budget:1024", planMode: true, rejectedMessageId: "rejected", files: [new File(["notes"], "notes.txt")] }
    mocks.store.limitReachedState = { show: true, pendingMessage: pending }
    renderSync().retryWithOpenCode()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.setState).toHaveBeenCalled()
    expect(pending.thinking).toBe("budget:1024")
    expect(pending.files[0].name).toBe("notes.txt")
  })

  it("sends the explicitly confirmed fallback once with files, chat, plan and rejected ID intact", async () => {
    const file = new File(["notes"], "notes.txt")
    const pending = { chatId: "chat", content: "Keep this prompt", agent: "gemini", model: "gemini-2.5-pro",
      thinking: "budget:1024", planMode: true, rejectedMessageId: "rejected", files: [file] }
    mocks.store.limitReachedState = { show: true, pendingMessage: pending }
    renderSync().retryWithOpenCode()
    const sync = renderSync()
    const request = sync.thinkingRecovery!
    expect(request).toMatchObject({ originalAgent: "gemini", originalModel: "gemini-2.5-pro", originalThinking: "budget:1024" })
    const first = sync.confirmThinkingRecovery(request.id, "default")
    await sync.confirmThinkingRecovery(request.id, "default")
    await first
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith("Keep this prompt", "opencode", "opencode/big-pickle", [file], "chat", true, "rejected", "default")
    expect(pending.thinking).toBe("budget:1024")
  })

  it("keeps recovery and its original files when dispatch is blocked, then allows an explicit retry", async () => {
    const file = new File(["notes"], "notes.txt")
    const pending = { chatId: "chat", content: "Keep with files", agent: "gemini", model: "gemini-2.5-pro", files: [file], thinking: "budget:1024" }
    const original = { show: true, pendingMessage: pending, provider: "gemini" }
    mocks.store.limitReachedState = original
    renderSync().retryWithOpenCode()
    const sync = renderSync()
    const request = sync.thinkingRecovery!
    mocks.send.mockResolvedValueOnce({ status: "blocked", reason: "busy" })
    expect(await sync.confirmThinkingRecovery(request.id, "default")).toMatchObject({ status: "blocked" })
    const blocked = renderSync()
    expect(blocked.thinkingRecovery).toMatchObject({ id: request.id, content: pending.content, files: [file] })
    blocked.dismissThinkingRecovery()
    expect(mocks.closeLimit).toHaveBeenLastCalledWith(original)
    renderSync().retryWithOpenCode()
    const next = renderSync()
    await next.confirmThinkingRecovery(next.thinkingRecovery!.id, "default")
    expect(mocks.send).toHaveBeenLastCalledWith(pending.content, "opencode", "opencode/big-pickle", [file], "chat", undefined, undefined, "default")
    expect(renderSync().thinkingRecovery).toBeUndefined()
  })

  it("does not discard or cancel in-memory recovery before dispatch has settled", async () => {
    let complete!: (value: { status: "accepted" }) => void
    mocks.send.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
    mocks.store.limitReachedState = { show: true, pendingMessage: { chatId: "chat", content: "Keep", files: [new File(["a"], "a.txt")] } }
    renderSync().retryWithOpenCode()
    const sync = renderSync()
    const request = sync.thinkingRecovery!
    const sending = sync.confirmThinkingRecovery(request.id, "default")
    sync.dismissThinkingRecovery()
    expect(renderSync().thinkingRecovery?.files).toEqual(request.files)
    complete({ status: "accepted" })
    await sending
    expect(renderSync().thinkingRecovery).toBeUndefined()
  })

  it("cancelling fallback restores the pending credit dialog including in-memory files", () => {
    const pending = { chatId: "chat", content: "Do not lose this", files: [new File(["notes"], "notes.txt")], thinking: "high" }
    const original = { show: true, pendingMessage: pending, provider: "claude", creditBalance: 0 }
    mocks.store.limitReachedState = original
    renderSync().retryWithOpenCode()
    renderSync().dismissThinkingRecovery()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.closeLimit).toHaveBeenLastCalledWith(original)
  })

  it("rejects confirmation from a superseded recovery attempt", () => {
    mocks.store.limitReachedState = { show: true, pendingMessage: { chatId: "chat", content: "Keep", thinking: "high" } }
    renderSync().retryWithOpenCode()
    const first = renderSync()
    first.retryWithOpenCode()
    renderSync()
    first.confirmThinkingRecovery(first.thinkingRecovery!.id, "default")
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("closes a stale Retry choice when the composer target changes while the dialog is open", () => {
    retryList()
    const dialog = findElement(renderList(), ThinkingRecoveryDialog)!
    expect(dialog).toBeDefined()
    const request = dialog.props.request as ThinkingRecoveryRequest
    expect(findElement(renderList("gpt-6.1-sol"), ThinkingRecoveryDialog)).toBeUndefined()
    ;(dialog.props.onConfirm as (id: string, thinking: string) => void)(request.id, "high")
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("a new last user message invalidates an open Retry confirmation", () => {
    retryList()
    const dialog = findElement(renderList(), ThinkingRecoveryDialog)!
    const request = dialog.props.request as ThinkingRecoveryRequest
    const newer = chat()
    newer.messages.push({ ...newer.messages[0], id: "newer", content: "Another prompt" })
    expect(findElement(renderList("gpt-6-luna", newer), ThinkingRecoveryDialog)).toBeUndefined()
    ;(dialog.props.onConfirm as (id: string, thinking: string) => void)(request.id, "high")
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("confirms a changed-target Retry without mutating historical or queued thinking", () => {
    const value = chat()
    retryList("gpt-6-luna", value)
    const dialog = findElement(renderList("gpt-6-luna", value), ThinkingRecoveryDialog)!
    const request = dialog.props.request as ThinkingRecoveryRequest
    ;(dialog.props.onConfirm as (id: string, thinking: string) => void)(request.id, "high")
    expect(mocks.send).toHaveBeenCalledWith("Keep this prompt", "codex", "gpt-6-luna", undefined, true, "high", { callerOwnsRecovery: true })
    expect(value.messages[0].metadata?.thinking).toBe("ultra")
  })

  it("retains an exact in-memory Retry snapshot and its files after blocking, without duplicate dispatch", async () => {
    const file = new File(["notes"], "notes.txt")
    retryList()
    const initial = findElement(renderList(), ThinkingRecoveryDialog)!
    const request = initial.props.request as ThinkingRecoveryRequest
    // Historical uploads only have filenames; this fixture supplies File[]
    // still held by an exact recovery request, not a content-based cache.
    request.files = [file]
    let finish!: (value: { status: "blocked"; reason: "busy"; message: string }) => void
    mocks.send.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const confirm = initial.props.onConfirm as (id: string, thinking: string) => Promise<unknown>
    const pending = confirm(request.id, "high")
    await confirm(request.id, "high")
    expect(mocks.send).toHaveBeenCalledOnce()
    const optimistic = chat()
    optimistic.status = "running"
    optimistic.messages.push({ id: "optimistic-retry", role: "user", content: request.content, timestamp: 3 })
    expect(findElement(renderList("gpt-6-luna", optimistic), ThinkingRecoveryDialog)?.props.request).toBe(request)
    finish({ status: "blocked", reason: "busy", message: "Wait for this turn" })
    expect(await pending).toMatchObject({ status: "blocked" })
    const retained = findElement(renderList(), ThinkingRecoveryDialog)!
    expect((retained.props.request as ThinkingRecoveryRequest).files).toEqual([file])
    await (retained.props.onConfirm as typeof confirm)(request.id, "high")
    expect(mocks.send).toHaveBeenLastCalledWith(request.content, "codex", "gpt-6-luna", [file], true, "high", { callerOwnsRecovery: true })
    expect(findElement(renderList(), ThinkingRecoveryDialog)).toBeUndefined()
  })
})
