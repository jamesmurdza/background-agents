import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Chat } from "@/lib/types"
import type { ChatWithMessagesResponse } from "@/lib/sync/api"

const mocks = vi.hoisted(() => ({ fetchChat: vi.fn(), client: { getQueryData: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn() } }))
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }), useEffect: () => {} }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => mocks.client }))
vi.mock("@/lib/query", () => ({ queryKeys: { chats: { list: () => ["chats"] }, settings: { all: ["settings"] } } }))
vi.mock("@/lib/sync/api", async (original) => ({ ...await original<typeof import("@/lib/sync/api")>(), fetchChat: mocks.fetchChat }))
vi.mock("@/lib/notify", () => ({ notifyCompletion: vi.fn() }))
vi.mock("@/lib/storage", () => ({ DEFAULT_SETTINGS: {} }))

import { useStreaming } from "./useStreaming"
import { useChatMessageSync } from "./useChatMessageSync"
import { useStreamStore } from "@/lib/stores/stream-store"

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onerror: (() => Promise<void>) | null = null
  constructor() { FakeEventSource.instances.push(this) }
  addEventListener() {}
  close() {}
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const chat = (id: string, updatedAt = 1): Chat => ({ id: "chat", repo: "__new__", baseBranch: "main", branch: null, sandboxId: "sandbox", sessionId: null, messages: [], createdAt: 1, updatedAt, displayName: null, status: "running", backgroundSessionId: id, activeAssistantMessageId: `assistant-${id}` })
const remote = (overrides: Partial<ChatWithMessagesResponse> = {}): ChatWithMessagesResponse => ({ ...chat("A"), agent: "eliza", model: "eliza", planModeEnabled: false, previewUrlPattern: null, parentChatId: null, needsSync: false, uncommittedFilesCount: 0, lastActiveAt: 1, backgroundSessionId: "A", activeAssistantMessageId: "assistant-A", messageCount: 0, messages: [], ...overrides })
let cache: Chat[]
const update = (fn: (value: Chat[]) => Chat[]) => { cache = fn(cache) }
const messageSync = () => useChatMessageSync({ chats: cache, currentChatId: "chat", isHydrated: true, updateChatsCache: update })

beforeEach(() => {
  vi.clearAllMocks()
  cache = [chat("A")]
  for (const id of useStreamStore.getState().streams.keys()) useStreamStore.getState().stopStream(id)
  FakeEventSource.instances = []
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ready", backgroundSessionId: null })))
  mocks.client.getQueryData.mockImplementation(() => cache)
  mocks.client.setQueryData.mockImplementation((_key, fn) => update(fn))
})
afterEach(() => { vi.unstubAllGlobals() })

describe("chat recovery across asynchronous turn changes", () => {
  it("does not let a failed old stream's delayed full read overwrite a newly started stream", async () => {
    const pending = deferred<ChatWithMessagesResponse>()
    mocks.fetchChat.mockReturnValue(pending.promise)
    const streaming = useStreaming()
    streaming.startStreaming("chat", "sandbox", "repo", "A", "assistant-A")
    const recovering = FakeEventSource.instances[0].onerror!()
    await vi.waitFor(() => expect(mocks.fetchChat).toHaveBeenCalled())
    cache = [chat("B", 2)]
    streaming.startStreaming("chat", "sandbox", "repo", "B", "assistant-B")
    pending.resolve(remote({ status: "ready", backgroundSessionId: null, activeAssistantMessageId: null }))
    await recovering
    expect(cache[0]).toMatchObject({ status: "running", backgroundSessionId: "B", activeAssistantMessageId: "assistant-B" })
    expect(useStreamStore.getState().getStream("chat")?.connectionParams?.backgroundSessionId).toBe("B")
  })

  it("reloads a disconnected chat using the running server turn, not a fabricated ready state", async () => {
    cache = [{ ...chat("A"), status: "disconnected", backgroundSessionId: undefined, errorMessage: "Connection lost" }]
    mocks.fetchChat.mockResolvedValue(remote())
    await messageSync().reloadChat("chat")
    expect(cache[0]).toMatchObject({ status: "running", backgroundSessionId: "A", activeAssistantMessageId: "assistant-A", errorMessage: undefined })
  })

  it.each(["new turn", "new send", "stop pending", "stop finished", "newer server version"])("ignores a delayed reload after %s", async (change) => {
    const pending = deferred<ChatWithMessagesResponse>()
    mocks.fetchChat.mockReturnValue(pending.promise)
    const loading = messageSync().reloadChat("chat")
    if (change === "new turn") cache = [chat("B", 2)]
    if (change === "new send") cache = [{ ...cache[0], pendingSend: true, status: "creating" }]
    if (change === "stop pending") cache = [{ ...cache[0], stopPending: true }]
    if (change === "stop finished") cache = [{ ...cache[0], status: "ready", backgroundSessionId: undefined, activeAssistantMessageId: undefined, queuePaused: true }]
    if (change === "newer server version") cache = [{ ...cache[0], updatedAt: 2, queuePaused: true }]
    const current = cache[0]
    pending.resolve(remote({ status: "ready", backgroundSessionId: null, activeAssistantMessageId: null }))
    await loading
    expect(cache[0]).toBe(current)
  })

  it("applies a current ready response and clears the old turn identity", async () => {
    mocks.fetchChat.mockResolvedValue(remote({ updatedAt: 2, status: "ready", backgroundSessionId: null, activeAssistantMessageId: null, queuePaused: true }))
    await messageSync().reloadChat("chat")
    expect(cache[0]).toMatchObject({ status: "ready", backgroundSessionId: undefined, activeAssistantMessageId: undefined, queuePaused: true, updatedAt: 2 })
  })
})
