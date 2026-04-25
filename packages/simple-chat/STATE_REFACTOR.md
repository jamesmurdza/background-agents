# State management refactor plan

## Goal

Migrate from the current single-bucket `useChatWithSync` (which holds server data, client UI state, and stream connection state in one ~1300-line hook backed by `useState`) to a three-layer split:

| Kind | Where it lives | Examples |
|---|---|---|
| Server state | TanStack Query | `chats`, individual chat detail + messages, `settings` |
| Client UI state | Zustand | `currentChatId`, sidebar collapsed, modals, draft chat, stream connections |
| Component-local | `useState` | textarea contents, modal-internal form state, hover/drag |

This is the de facto React state pattern in 2026 and addresses several open architectural items at once (mixed-state `Chat` object, hook bloat, stream lifecycle in `useEffect`, `mergeChats`/`mergeMessages` reconciliation).

Each phase below leaves the app working. Nothing is broken in the middle if scoped properly.

---

## Phase 0 — setup (~30 min)

1. `npm install @tanstack/react-query @tanstack/react-query-devtools`
2. Create `app/providers.tsx` exporting a `QueryClient` wrapped in `QueryClientProvider`. Defaults:
   - `staleTime: 30s` (chat list isn't real-time critical; SSE handles live data)
   - `refetchOnWindowFocus: false` (don't fight the SSE stream for liveness)
   - `retry: 1`
3. Wrap `app/layout.tsx`'s body in the provider. Add `<ReactQueryDevtools />` in dev.
4. Create `lib/queries/keys.ts` with a typed key factory:
   ```ts
   export const chatKeys = {
     all: ["chats"] as const,
     detail: (id: string) => ["chats", id] as const,
   }
   export const settingsKeys = { all: ["settings"] as const }
   ```

**Ship on its own.** No behavioral change; just infrastructure.

---

## Phase 1 — read queries coexisting with the hook (~half day)

The goal: components can pull server data from TanStack Query, but `useChatWithSync` still works for everyone who hasn't migrated.

1. `lib/queries/chats.ts`:
   - `useChatsQuery()` → wraps `fetchChats()`. Returns the chat list.
   - `useChatQuery(chatId)` → wraps `fetchChat(chatId)`. `enabled: !!chatId`.
2. `lib/queries/settings.ts`:
   - `useSettingsQuery()` → wraps `fetchSettings()`, returns `{ settings, credentialFlags }` already converted via `toSettingsType`.
3. Inside `useChatWithSync`, the existing load-from-server `useEffect` is **deleted**. The hook reads the same data via the query hooks and exposes it through its existing return shape. Components that already use the hook continue to work with no change.
4. Remove `mergeChats` / `mergeMessages` from the load path. Local-only fields (`previewItem`, `queuedMessages`, etc.) get spliced in via a small `withLocalFields(chats, localState)` helper at read time, since those are device-local and don't belong in query cache.

**Ship.** Behavior should be identical — same data, different fetcher.

**Risk:** the current `mergeChats` / `mergeMessages` logic was preserving in-flight streaming content over stale server responses. We need streaming updates to write into the query cache (Phase 4) before this can fully ship safely. Until then: pin the chat detail query as `enabled: !isStreaming(chatId)` so a refetch can't race a stream.

---

## Phase 2 — mutations as TanStack mutations (~half day)

Replace each mutating action in `useChatWithSync` with a `useMutation`:

1. **`useCreateChat`** — POST `/api/chats`. `onSuccess`: `queryClient.setQueryData(chatKeys.all, cur => [newChat, ...cur])`.
2. **`useUpdateChat(chatId)`** — PATCH. Optimistic update via `onMutate` writing into both `chatKeys.detail(chatId)` and `chatKeys.all`. `onError` rollback.
3. **`useDeleteChat()`** — DELETE. Wraps the existing `apiDeleteChat` + per-sandbox `/api/sandbox/delete` cleanup. `onSuccess`: remove from `chatKeys.all`, drop `chatKeys.detail(deletedId)` for each.
4. **`useUpdateSettings()`** — PATCH `/api/user/settings`. Optimistic. Returns the same `{ ok, error }` shape `SettingsModal` consumes.
5. **`useSendMessage(chatId)`** — biggest one. POSTs to `/api/chats/[chatId]/messages`.
   - `onMutate`: writes the optimistic user + assistant placeholder messages into `chatKeys.detail(chatId)` cache.
   - On success: stores returned `sandboxId` / `branch` / `previewUrlPattern` / `backgroundSessionId` in cache. Returns these so the caller can `streamStore.startStream(...)`.
   - On error: marks the assistant message as `isError: true` in cache.

The mutations live in `lib/mutations/*.ts`. Components import them directly. `useChatWithSync`'s mutation methods become wrappers around these, then get deleted in Phase 6.

---

## Phase 3 — UI Zustand store (~half day)

Create `lib/stores/ui-store.ts`. Single store, multiple slices:

```ts
interface UIStore {
  // Selection
  currentChatId: string | null
  setCurrentChatId(id: string | null): void

  // Sidebar
  sidebarCollapsed: boolean
  sidebarWidth: number
  mobileSidebarOpen: boolean
  // ...setters

  // Modals
  signInModalOpen: boolean
  helpOpen: boolean
  settingsOpen: boolean
  settingsHighlightKey: HighlightKey | null
  // ...setters

  // Filters & navigation
  repoFilter: string
  collapsedChatIds: Set<string>

  // Local-only chat fields (the ones that don't belong on the Chat object)
  previewItems: Record<string, PreviewItem | null>
  queuedMessages: Record<string, QueuedMessage[]>
  queuePaused: Record<string, boolean>

  // Tracking
  unseenChatIds: Set<string>
  deletingChatIds: Set<string>

  // Draft state (unauth)
  draftAgent: string | null
  draftModel: string | null
  pendingMessage: PendingMessage | null  // synced with sessionStorage
}
```

Use Zustand `persist` middleware (or a custom subscriber) for the device-local fields: `currentChatId`, `sidebarWidth`, `previewItems`, `queuedMessages`, `queuePaused`, `unseenChatIds`. Replaces what `lib/storage.ts` was doing for these.

`pendingMessage` syncs with `sessionStorage` via a custom storage adapter.

Migrate consumers piece-by-piece:
- `app/page.tsx` — replace `useState` calls for sidebar/modals/draft/etc. with `useUIStore(s => s.X)`.
- `Sidebar.tsx`, `ChatPanel.tsx`, etc. — same pattern.

Each component migration is independent. Ship as you go.

---

## Phase 4 — SSE writes to query cache (~half day)

The `update` / `complete` SSE handlers currently call `setState` on the hook's chat array. Replace with direct cache writes:

```ts
queryClient.setQueryData(chatKeys.detail(chatId), (cur: ChatDetail | undefined) => {
  if (!cur) return cur
  const messages = [...cur.messages]
  const lastIdx = messages.findIndex(m => m.id === assistantMessageId)
  if (lastIdx >= 0) {
    messages[lastIdx] = {
      ...messages[lastIdx],
      content: data.content,
      toolCalls: data.toolCalls,
      contentBlocks: data.contentBlocks,
    }
  }
  return { ...cur, messages, lastActiveAt: Date.now() }
})
```

Plus a simultaneous `setQueryData(chatKeys.all, ...)` to update the chat-list summary (`lastActiveAt`, `status`).

Once this lands, the `enabled: !isStreaming` guard from Phase 1 can be removed — the cache is always fresh.

---

## Phase 5 — stream store owns connection lifecycle (~half day)

Refactor `useStreamStore` to actually own the connection:

```ts
interface StreamStore {
  streams: Map<string, StreamState>
  connect(chatId: string, params: StreamParams): void   // creates the EventSource
  disconnect(chatId: string): void                       // closes it
  ensureStreamsFor(chats: Chat[]): void                  // for hydration recovery
}
```

The actions internally:
1. Create the `EventSource`.
2. Wire up `update` / `complete` / `error` listeners that write directly to the query cache (Phase 4 helpers).
3. Track `cursor` / `reconnectAttempts` / `connectionParams` for reconnect.

Drop the recovery `useEffect` in `useChatWithSync`. Replace with one tiny effect in a top-level component:

```ts
const chats = useChatsQuery().data ?? []
useEffect(() => {
  useStreamStore.getState().ensureStreamsFor(chats)
}, [chats])
```

`ensureStreamsFor` is idempotent — it only opens connections for chats that need one and aren't already connected. The thrash-on-state-change problem disappears because the store dedupes internally.

---

## Phase 6 — delete `useChatWithSync` (~hour)

By this point every responsibility of the old hook has moved:

| Old hook concern | New home |
|---|---|
| Server reads | TanStack Query |
| Server writes | TanStack Mutations |
| UI state | UI Zustand store |
| Stream connection lifecycle | Stream Zustand store |
| `mergeChats` / `mergeMessages` | Deleted (cache replaces this) |

Delete the file. Update `app/page.tsx` imports.

---

## Phase 7 — clean up `lib/storage.ts` (~hour)

Server-cache helpers (`updateCacheChats`, `updateCacheChat`, `addCacheChat`, `removeCacheChats`, `updateCacheMessages`, `updateCacheLastMessage`, `updateCacheSettings`) are now dead — TanStack Query is the cache.

Device-local helpers (`loadLocalState`, `setCurrentChatId`, `setQueuedMessages`, etc.) are subsumed by Zustand `persist`.

Delete what's dead. Keep what's still used (probably nothing if Zustand persist takes over fully).

---

## Phase 8 — minimal tests for the new surface (~half day, optional but strongly advised)

Without these, the migration is bug-prone. Recommended minimum:

1. **`useSendMessage` mutation:** optimistic insert lands; on success the message has the server-confirmed sandboxId; on error the assistant message is marked `isError`.
2. **SSE update handler:** writes cumulative snapshot to cache; doesn't append.
3. **Stream store:** `connect` + `disconnect` + `ensureStreamsFor` are idempotent.
4. **UI store persist:** `currentChatId` / `sidebarWidth` survive reload.

Vitest + `@testing-library/react` for the hook tests, MSW for fetch mocking.

---

## Risks to flag before starting

1. **The current `mergeChats` / `mergeMessages` logic might be hiding semantics I haven't traced.** Phase 1 deletes them; if the app misbehaves after Phase 1, the issue is probably here. Audit them first or keep as a fallback during migration.

2. **Optimistic update + SSE + server response race.** When `useSendMessage` resolves, the server has confirmed the assistant message exists. The SSE may have already started writing to that message via cache. The mutation's `onSuccess` should *not* clobber the SSE-written content. Use `setQueryData(key, cur => ...)` with a check that preserves any already-streamed content rather than wholesale replace.

3. **Pending-message replay after OAuth.** Currently a two-effect dance. The new design: `pendingMessage` lives in Zustand, persisted to sessionStorage. After sign-in: one async flow that calls `createChat.mutateAsync()` + `sendMessage.mutate()` in sequence. Cleaner, but verify the `useSession` hook signals properly.

4. **Streaming content survives cache invalidation.** If a mutation invalidates `chatKeys.detail(chatId)` while a stream is active, the next refetch could blow away the streamed text. Either: (a) don't invalidate detail queries while streaming, (b) use `setQueryData` exclusively (no refetch invalidation), (c) the SSE handler writes after every refetch. Option (b) is the cleanest.

5. **The `Chat` object's mixed-state problem is implicitly fixed by this migration** — server-tracked fields end up in query cache, device-local fields end up in the UI store. They never share an object again.

---

## Adjacent items this migration touches

If we're doing this anyway, these become trivial to fold in:

- **Split `useChatWithSync`.** Done by deletion in Phase 6.
- **Chat state split + audit `mergeChats`.** Done by replacement.
- **Lift stream lifecycle out of `useEffect`.** Done in Phase 5.
- **Pending-send dance / auto-create ordering.** Become a single async flow in Phase 3.
- **`local-*` cache filter is read-only.** Storage layer is rewritten in Phase 7.

These remain orthogonal and stay open after the migration:

- `selectChat` retry button (UI affordance for `messagesLoadFailed`)
- Route relocation under `/api/chats/[chatId]/...`
- Typed/versioned wire protocol for SSE
- Sentinel union types (`NEW_REPOSITORY` etc.)
- Broader test coverage

---

## Total estimated effort

~3–4 focused engineering days. Ship-points after Phase 0, 1, 2, 3, 4, 5, 6+7. Each phase produces a working app.

## Recommended subset if you can't allocate the full migration

The highest-value slice is **Phases 0 + 1 + 4** (~1 day). Together they retire the `mergeChats` reconciliation and the `loadFromServer` `useEffect` — the source of the unaudited bugs flagged in earlier audits. The rest can come incrementally.
