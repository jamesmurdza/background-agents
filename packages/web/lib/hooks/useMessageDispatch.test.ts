import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useStreamStore } from "@/lib/stores/stream-store"
import { queryKeys } from "@/lib/query"
import { acknowledgeDirectSends } from "@/lib/direct-send-recovery"

const mocks = vi.hoisted(() => ({ send: vi.fn(), fetchChat: vi.fn() }))
vi.mock("./useServerQueue", () => ({ useServerQueue: () => ({ enqueueMessage: vi.fn(), removeQueuedMessage: vi.fn(), resumeQueue: vi.fn() }) }))
vi.mock("@/lib/chat-messages", async (original) => ({ ...await original<typeof import("@/lib/chat-messages")>(), sendMessageToApi: mocks.send }))
vi.mock("@/lib/sync/api", async (original) => ({ ...await original<typeof import("@/lib/sync/api")>(), fetchChat: mocks.fetchChat }))
vi.mock("@/lib/stores/chat-sync-store", async (original) => {
  const actual = await original<typeof import("@/lib/stores/chat-sync-store")>()
  const store = actual.useChatSyncStore
  return { ...actual, useChatSyncStore: Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) => selector(store.getState()),
    { getState: store.getState, setState: store.setState, subscribe: store.subscribe }
  ) }
})
import { useMessageDispatch } from "./useMessageDispatch"

// A promise plus its own resolve/reject, for tests that need to control when
// a mocked async call settles (e.g. a delayed response racing a UI update).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<Parameters<typeof useMessageDispatch>[0]> = {}) {
  const client = new QueryClient()
  const chat = { id: "chat-1", repo: "__new__", messages: [], status: "ready", updatedAt: 0, createdAt: 0, sandboxId: null, agent: "eliza", model: "eliza-classic-1.0", baseBranch: null, branch: null, sessionId: null, displayName: null } as unknown as Chat
  client.setQueryData(queryKeys.chats.list(), [chat])
  const stream = vi.fn()
  let result: ReturnType<typeof useMessageDispatch> | undefined
  function Probe() {
    result = useMessageDispatch({
      currentChatId: chat.id, currentChat: chat, chats: [chat], isHydrated: true,
      session: { user: { id: "test" }, expires: "2099" }, settings: DEFAULT_SETTINGS, credentialFlags: {},
      updateChatsCache: (fn) => client.setQueryData<Chat[]>(queryKeys.chats.list(), (old) => fn(old ?? [])),
      startStreaming: stream, suggestNameMutation: { mutate: vi.fn() } as unknown as Parameters<typeof useMessageDispatch>[0]["suggestNameMutation"],
      isDraftChatId: (id) => !!id?.startsWith("draft-"), materializeDraft: async () => null,
      reloadMessages: async () => {}, queryClient: client, onConflictStateChangeRef: { current: null },
      ...overrides,
    })
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return { dispatch: result!, client, stream, chat }
}

beforeEach(() => {
  vi.clearAllMocks()
  const stored = new Map<string, string>()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() { return stored.size },
  })
  useChatSyncStore.setState({ localChatState: { previewStates: {}, drafts: {}, queuePaused: {}, queuedMessages: {} } })
  useStreamStore.setState({ streams: new Map() })
})
afterEach(() => { vi.unstubAllGlobals() })

describe("direct-send failure ownership", () => {
  it.each(["creating", "running"] as const)("reports a blocked %s chat without taking ownership of the retry", async (status) => {
    const initial = setup()
    const { dispatch } = setup({ chats: [{ ...initial.chat, status }] })
    expect(await dispatch.sendMessage("Keep with files", "eliza", "eliza-classic-1.0", [new File(["notes"], "notes.txt")]))
      .toMatchObject({ status: "blocked", reason: "busy" })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("reports a missing login without consuming the retry", async () => {
    const { dispatch } = setup({ session: null })
    expect(await dispatch.sendMessage("Keep this"))
      .toMatchObject({ status: "blocked", reason: "unauthenticated" })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("reports an active stream as blocked even when the rendered chat is ready", async () => {
    const { dispatch, chat } = setup()
    useStreamStore.getState().startStream(chat.id, { sandboxId: "s", repoName: "project", backgroundSessionId: "job", assistantMessageId: "a" })
    expect(await dispatch.sendMessage("Keep this")).toMatchObject({ status: "blocked", reason: "busy" })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("reports an in-flight Stop as blocked without dropping a retry", async () => {
    const { promise, resolve } = deferred<Response>()
    vi.stubGlobal("fetch", vi.fn(() => promise))
    const initial = setup()
    const { dispatch } = setup({ currentChat: { ...initial.chat, backgroundSessionId: "job", activeAssistantMessageId: "a" } })
    const stopping = dispatch.stopAgent()
    expect(await dispatch.sendMessage("Keep this")).toMatchObject({ status: "blocked", reason: "busy" })
    expect(mocks.send).not.toHaveBeenCalled()
    resolve(new Response(null, { status: 200 }))
    await stopping
  })

  it("rejects a second concurrent send without discarding its caller's retry", async () => {
    const { promise, resolve } = deferred<unknown>()
    mocks.send.mockReturnValueOnce(promise)
    const { dispatch } = setup()
    const first = dispatch.sendMessage("First")
    expect(await dispatch.sendMessage("Second")).toMatchObject({ status: "blocked", reason: "busy" })
    expect(mocks.send).toHaveBeenCalledOnce()
    resolve({ ok: true, data: { sandboxId: "s", backgroundSessionId: "job" } })
    expect(await first).toEqual({ status: "accepted" })
  })

  it("reports a confirmed server busy rejection as blocked rather than an accepted send", async () => {
    mocks.send.mockResolvedValue({ ok: false, isChatBusy: true, error: "Chat is busy" })
    const { dispatch } = setup()
    expect(await dispatch.sendMessage("Keep this"))
      .toMatchObject({ status: "blocked", reason: "busy" })
  })

  it("keeps a server-rejected fallback in its dialog instead of duplicating it in the newer draft", async () => {
    mocks.send.mockResolvedValue({ ok: false, isChatBusy: true, error: "Chat is busy" })
    const { dispatch, chat } = setup({ reloadMessages: async () => { throw new Error("Refresh unavailable") } })
    useChatSyncStore.getState().setDraftText(chat.id, "A newer draft")
    expect(await dispatch.sendMessage("Retry this", "eliza", "eliza-classic-1.0", undefined, chat.id, undefined, "rejected-original"))
      .toMatchObject({ status: "blocked", reason: "busy" })
    expect(useChatSyncStore.getState().localChatState.drafts[chat.id]).toBe("A newer draft")
  })

  it("transfers an uncertain transport failure to direct-send recovery without permitting an automatic resend", async () => {
    mocks.send.mockRejectedValue(new Error("Response lost"))
    mocks.fetchChat.mockRejectedValue(new Error("Offline"))
    const { dispatch } = setup()
    expect(await dispatch.sendMessage("Check saved state first"))
      .toEqual({ status: "accepted" })
  })

  it("restores a failed materialization without dropping a newer draft or sending a message", async () => {
    const { promise: materialization, resolve: release } = deferred<null>()
    const { dispatch } = setup({ currentChatId: "draft-1", materializeDraft: () => materialization })
    const sending = dispatch.sendMessage("Original first prompt")
    useChatSyncStore.getState().setDraftText("draft-1", "Newer draft")
    release(null)
    await sending
    expect(useChatSyncStore.getState().localChatState.drafts["draft-1"]).toBe("Original first prompt\n\nNewer draft")
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("does not let a delayed successful response replace a newer active turn", async () => {
    const { promise, resolve: release } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    const { dispatch, client, stream, chat } = setup()
    const sending = dispatch.sendMessage("First request", "eliza", "eliza-classic-1.0")
    const newer = { ...chat, updatedAt: 5, status: "running", activeAssistantMessageId: "assistant-new", backgroundSessionId: "background-new" } as Chat
    client.setQueryData(queryKeys.chats.list(), [newer])
    release({ ok: true, data: { sandboxId: "sandbox-old", backgroundSessionId: "background-old", uploadedFiles: [], branch: null, previewUrlPattern: null } })
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0]).toEqual(newer)
    expect(stream).not.toHaveBeenCalled()
    expect(useChatSyncStore.getState().localChatState.queuedMessages[chat.id] ?? []).toHaveLength(0)
  })

  it("does not remove acknowledged server rows when a delayed POST error arrives", async () => {
    const { promise, reject } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    mocks.fetchChat.mockRejectedValue(new Error("Still offline"))
    const { dispatch, client, chat } = setup()
    const sending = dispatch.sendMessage("Please say 4", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    const saved = { ...chat, pendingSend: true, pendingSendAssistantMessageId: pending.activeAssistantMessageId, updatedAt: 5, messages: pending.messages.map((message) => ({ ...message, content: message.role === "assistant" ? "4" : message.content })) }
    acknowledgeDirectSends(chat.id, saved.messages)
    client.setQueryData(queryKeys.chats.list(), [saved])
    reject(new Error("Response lost"))
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0]).toEqual({ ...saved, pendingSend: false, pendingSendAssistantMessageId: undefined })
    expect(useChatSyncStore.getState().localChatState.queuedMessages[chat.id] ?? []).toHaveLength(0)
  })

  it("does not restart an acknowledged finished turn when its delayed POST success arrives", async () => {
    const { promise, resolve: release } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    const { dispatch, client, stream, chat } = setup()
    const sending = dispatch.sendMessage("Please say 4", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    const finished = { ...chat, updatedAt: 5, messages: pending.messages.map((message) => ({ ...message, content: message.role === "assistant" ? "4" : message.content })) }
    acknowledgeDirectSends(chat.id, finished.messages)
    client.setQueryData(queryKeys.chats.list(), [finished])
    release({ ok: true, data: { sandboxId: "sandbox-old", backgroundSessionId: "background-old", uploadedFiles: [], branch: null, previewUrlPattern: null } })
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0]).toEqual(finished)
    expect(stream).not.toHaveBeenCalled()
  })

  it("keeps an unconfirmed original as a labeled local copy, not an optimistic saved bubble", async () => {
    mocks.send.mockRejectedValue(new Error("Gateway error"))
    mocks.fetchChat.mockRejectedValue(new Error("Still offline"))
    const { dispatch, client, chat } = setup()
    await dispatch.sendMessage("Original text", "eliza", "eliza-classic-1.0")
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0].messages).toHaveLength(0)
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0].status).toBe("disconnected")
    expect(useChatSyncStore.getState().localChatState.queuedMessages[chat.id]?.[0]).toMatchObject({ content: "Original text", directSend: { error: "Gateway error" } })
  })

  it("hands a known-rejected limit prompt to an explicitly selected fallback without retaining two device copies", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, isDailyLimit: true, error: "DAILY_LIMIT_EXCEEDED" })
    const initial = setup()
    await initial.dispatch.sendMessage("Original limited prompt", "eliza", "eliza-classic-1.0")
    const original = useChatSyncStore.getState().localChatState.queuedMessages[initial.chat.id]![0]
    expect(original.content).toBe("Original limited prompt")
    mocks.send.mockResolvedValueOnce({ ok: true, data: { sandboxId: "sandbox-fallback", backgroundSessionId: "background-fallback", uploadedFiles: [], branch: null, previewUrlPattern: null } })
    const fallback = setup()
    await Reflect.apply(fallback.dispatch.sendMessage, undefined,
      [original.content, "opencode", undefined, undefined, initial.chat.id, undefined, original.id])
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(useChatSyncStore.getState().localChatState.queuedMessages[initial.chat.id] ?? []).toHaveLength(0)
  })

  it("keeps the rejected original when the fallback cannot begin because another turn is running", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, isDailyLimit: true, error: "DAILY_LIMIT_EXCEEDED" })
    const initial = setup()
    await initial.dispatch.sendMessage("Original limited prompt", "eliza", "eliza-classic-1.0")
    const original = useChatSyncStore.getState().localChatState.queuedMessages[initial.chat.id]![0]
    const fallback = setup({ chats: [{ ...initial.chat, status: "running", activeAssistantMessageId: "another-turn" }] })
    await Reflect.apply(fallback.dispatch.sendMessage, undefined,
      [original.content, "opencode", undefined, undefined, initial.chat.id, undefined, original.id])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(useChatSyncStore.getState().localChatState.queuedMessages[initial.chat.id]).toEqual([original])
  })

  it.each([
    { ok: false, isDailyLimit: true, error: "DAILY_LIMIT_EXCEEDED" },
    { ok: false, isChatBusy: true, isDailyLimit: false, error: "Chat is busy" },
    { ok: false, isPullConflict: true, error: "PULL_CONFLICT", conflictedFiles: [], branch: null },
  ])("keeps a newer active owner when a delayed explicit rejection arrives: $error", async (rejection) => {
    const { promise, resolve: release } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    const { dispatch, client, chat } = setup()
    const sending = dispatch.sendMessage("Rejected attempt", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    client.setQueryData(queryKeys.chats.list(), [{ ...pending, status: "running", activeAssistantMessageId: "assistant-new", backgroundSessionId: "background-new" }])
    release(rejection)
    await sending
    const current = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    expect(current.status).toBe("running")
    expect(current.activeAssistantMessageId).toBe("assistant-new")
    expect(current.backgroundSessionId).toBe("background-new")
    expect(current.messages).toEqual(chat.messages)
  })

  it.each(["success", "rejection", "network error"])("does not clear a newer browser POST's pending flag on old %s", async (outcome) => {
    const { promise, resolve: release, reject } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    mocks.fetchChat.mockRejectedValue(new Error("Offline"))
    const { dispatch, client } = setup()
    const sending = dispatch.sendMessage("Older request", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    client.setQueryData(queryKeys.chats.list(), [{ ...pending, status: "running", activeAssistantMessageId: "assistant-new", backgroundSessionId: "background-new", pendingSendAssistantMessageId: "assistant-new", pendingSend: true }])
    if (outcome === "network error") reject(new Error("Response lost"))
    else release(outcome === "rejection"
      ? { ok: false, isChatBusy: true, isDailyLimit: false, error: "Chat is busy" }
      : { ok: true, data: { sandboxId: "sandbox-old", backgroundSessionId: "background-old", uploadedFiles: [], branch: null, previewUrlPattern: null } })
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())![0]).toMatchObject({ status: "running", activeAssistantMessageId: "assistant-new", pendingSend: true, pendingSendAssistantMessageId: "assistant-new" })
  })
})
