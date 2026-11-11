import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { queryKeys } from "@/lib/query"

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
  useChatSyncStore.setState({ localChatState: { previewStates: {}, drafts: {}, queuedMessages: {} }, draftChatConfig: undefined })
})
afterEach(() => { vi.unstubAllGlobals() })

describe("direct-send failure ownership", () => {
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
  })

  it("does not remove acknowledged server rows when a delayed POST error arrives", async () => {
    const { promise, reject } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    mocks.fetchChat.mockRejectedValue(new Error("Still offline"))
    const { dispatch, client, chat } = setup()
    const sending = dispatch.sendMessage("Please say 4", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    const saved = { ...chat, pendingSend: true, pendingSendAssistantMessageId: pending.activeAssistantMessageId, updatedAt: 5, messages: pending.messages.map((message) => ({ ...message, content: message.role === "assistant" ? "4" : message.content })) }
    client.setQueryData(queryKeys.chats.list(), [saved])
    reject(new Error("Response lost"))
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0]).toEqual({ ...saved, pendingSend: false, pendingSendAssistantMessageId: undefined })
  })

  it("does not restart an acknowledged finished turn when its delayed POST success arrives", async () => {
    const { promise, resolve: release } = deferred<unknown>()
    mocks.send.mockReturnValue(promise)
    const { dispatch, client, stream, chat } = setup()
    const sending = dispatch.sendMessage("Please say 4", "eliza", "eliza-classic-1.0")
    const pending = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    const finished = { ...chat, updatedAt: 5, messages: pending.messages.map((message) => ({ ...message, content: message.role === "assistant" ? "4" : message.content })) }
    client.setQueryData(queryKeys.chats.list(), [finished])
    release({ ok: true, data: { sandboxId: "sandbox-old", backgroundSessionId: "background-old", uploadedFiles: [], branch: null, previewUrlPattern: null } })
    await sending
    expect(client.getQueryData<Chat[]>(queryKeys.chats.list())?.[0]).toEqual(finished)
    expect(stream).not.toHaveBeenCalled()
  })

  it("keeps a failed prompt on screen with an error so it can be retried", async () => {
    mocks.send.mockRejectedValue(new Error("Gateway error"))
    mocks.fetchChat.mockRejectedValue(new Error("Still offline"))
    const { dispatch, client } = setup()
    await dispatch.sendMessage("Original text", "eliza", "eliza-classic-1.0")
    const current = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    expect(current.messages.map((message) => message.content)).toEqual(["Original text"])
    expect(current).toMatchObject({ status: "error", errorMessage: "Gateway error" })

    // Retry replaces the failed bubble instead of adding a second copy.
    await dispatch.sendMessage("Original text", "eliza", "eliza-classic-1.0")
    const retried = client.getQueryData<Chat[]>(queryKeys.chats.list())![0]
    expect(retried.messages.map((message) => message.content)).toEqual(["Original text"])
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

describe("first send from a draft", () => {
  const ok = { ok: true, data: { sandboxId: "sandbox-1", backgroundSessionId: "background-1", uploadedFiles: [], branch: null, previewUrlPattern: null } }

  function sendFromDraft(pendingMcpServers?: { slug: string; name: string; iconUrl: null; attachPath: string }[]) {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      return new Response(null, { status: 201 })
    }))
    mocks.send.mockImplementation(async () => { calls.push("send message"); return ok })
    useChatSyncStore.setState({ draftChatConfig: { id: "draft-1", repo: "__new__", baseBranch: "main", agent: null, model: null, pendingMcpServers } })
    const { dispatch, chat } = setup({ currentChatId: "draft-1", materializeDraft: async () => chat })
    return { calls, sending: dispatch.sendMessage("Use GitHub", "eliza", "eliza-classic-1.0") }
  }

  it("attaches MCP servers picked on the draft before sending the first message", async () => {
    const { calls, sending } = sendFromDraft([{ slug: "github/github", name: "GitHub", iconUrl: null, attachPath: "github" }])
    await sending
    expect(calls).toEqual(["POST /api/chats/chat-1/mcp-servers/github", "send message"])
  })

  it("sends without extra requests when no MCP servers were picked", async () => {
    const { calls, sending } = sendFromDraft()
    await sending
    expect(calls).toEqual(["send message"])
  })
})
