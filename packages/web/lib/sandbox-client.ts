/**
 * Client-side helper shared by actions that need a running sandbox but
 * aren't sending a message — e.g. Terminal / "Open in VS Code" on a draft
 * chat, or the Merge dialog's materialize-then-merge flow.
 *
 * Draft chats live in the browser only and have no sandbox. These callers
 * materialize the draft into a real chat row first, then hit
 * `/api/chats/[chatId]/sandbox/ensure` to make sure it has a live sandbox,
 * before proceeding with whatever action actually needed one.
 */

import type { QueryClient } from "@tanstack/react-query"
import { useToastStore } from "@/lib/stores/toast-store"
import { queryKeys } from "@/lib/query/keys"
import type { Chat } from "@/lib/types"
import type { PendingMcpServer } from "@/lib/storage"

export interface EnsuredDraftSandbox {
  chatId: string
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
}

type PendingEnv = {
  environmentVariables: Record<string, string> | undefined
  clearPending: () => void
}

/** Patch fields onto a chat in both the list and detail query caches (same
 * query keys `useCreateChatMutation` writes), so every consumer of the
 * cached chat object — not just whoever awaited the call that produced this
 * patch — picks it up on its next render instead of waiting for an
 * unrelated background refetch to backfill it. */
function patchChatCache(queryClient: QueryClient, chatId: string, patch: Partial<Chat>) {
  // Only overwrite fields the caller actually has a value for — an
  // `undefined` entry (e.g. the ensure response not returning a branch)
  // must leave the existing cached value alone, not blank it out.
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const apply = (chat: Chat): Chat => ({ ...chat, ...defined })
  queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old) =>
    old?.map((c) => (c.id === chatId ? apply(c) : c))
  )
  queryClient.setQueryData<Chat>(queryKeys.chats.detail(chatId), (old) => (old ? apply(old) : old))
}

type PendingMcp = {
  servers: PendingMcpServer[] | undefined
  clearPending: () => void
}

/**
 * Apply MCP servers staged on a draft (see `DraftChatConfig.pendingMcpServers`
 * in lib/storage.ts, written by McpServersCombobox while a chat is still a
 * draft) against the now-real chat — best-effort, a failure here doesn't
 * block materialization. Mirrors the env var application below.
 */
async function applyPendingMcpServers(chatId: string, pendingMcp: PendingMcp): Promise<void> {
  if (!pendingMcp.servers || pendingMcp.servers.length === 0) return
  try {
    await Promise.all(
      pendingMcp.servers.map((server) =>
        server.attachPath
          ? fetch(`/api/chats/${chatId}/mcp-servers/${server.attachPath}`, { method: "POST" })
          : fetch(`/api/chats/${chatId}/mcp-servers`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug: server.slug,
                url: server.url,
                name: server.name,
                iconUrl: server.iconUrl,
              }),
            })
      )
    )
    pendingMcp.clearPending()
  } catch (err) {
    // Best-effort: the chat still materializes even if this fails; the user
    // can reattach the server(s) from the real chat.
    console.error("[sandbox-client] Failed to apply staged draft MCP servers:", err)
  }
}

/**
 * Materialize a draft chat (if `materializeDraft` resolves it) as status
 * "creating" — not "pending" — so every consumer reading `chat.status`
 * (e.g. the composer's `canSend`/`isCreating` gate in useChatComposer.ts)
 * blocks the chat immediately, without waiting on the sandbox-ensure round
 * trip below to land. `ensureSandboxForChat` resolves the status to "ready"
 * or "error" once that round trip settles.
 *
 * Also applies any env vars staged on the draft (see
 * `DraftChatConfig.pendingEnvironmentVariables` in lib/storage.ts, written
 * by the Env Vars modal while a chat is still a draft) — best-effort, a
 * failure here doesn't block the caller's actual action. Returns the real
 * chat id, or `null` if materializing failed.
 *
 * Split out from `ensureSandboxForChat` so callers that want to flip the UI
 * from the draft/welcome screen to the real chat screen immediately (e.g.
 * opening the Terminal panel) don't have to wait for the sandbox to finish
 * booting first — only for this fast step.
 */
export async function materializeDraftChat(
  draftId: string,
  materializeDraft: (draftId: string, options?: { status?: Chat["status"] }) => Promise<{ id: string } | null>,
  pendingEnv?: PendingEnv,
  pendingMcp?: PendingMcp
): Promise<string | null> {
  const materialized = await materializeDraft(draftId, { status: "creating" })
  if (!materialized) return null

  const chatId = materialized.id

  if (pendingEnv?.environmentVariables && Object.keys(pendingEnv.environmentVariables).length > 0) {
    try {
      await fetch(`/api/chats/${chatId}/env`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentVariables: pendingEnv.environmentVariables }),
      })
      pendingEnv.clearPending()
    } catch (err) {
      // Best-effort: the chat still materializes and gets a sandbox even if
      // this fails; the user can re-enter the env vars from the real chat.
      console.error("[sandbox-client] Failed to apply staged draft env vars:", err)
    }
  }

  if (pendingMcp) {
    await applyPendingMcpServers(chatId, pendingMcp)
  }

  return chatId
}

/**
 * Hit `/api/chats/[chatId]/sandbox/ensure` to make sure the chat has a
 * running sandbox, then patch the result into the TanStack Query chat cache
 * so every consumer of the cached chat object (not just whoever awaited this
 * call) picks up the new `sandboxId`/`branch`/`previewUrlPattern` on its next
 * render, instead of waiting for an unrelated background refetch to
 * backfill it.
 *
 * Also resolves the "creating" status `materializeDraftChat` set: "ready" on
 * success, "error" on failure — mirroring the server-side status lifecycle
 * in `ensureSandboxRunning` (lib/sandbox.ts), so a chat that was materialized
 * via this path never gets stuck showing as blocked/creating forever.
 */
export async function ensureSandboxForChat(
  chatId: string,
  queryClient: QueryClient
): Promise<EnsuredDraftSandbox | null> {
  try {
    const res = await fetch(`/api/chats/${chatId}/sandbox/ensure`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error("[sandbox-client] Failed to ensure sandbox for materialized draft:", data)
      patchChatCache(queryClient, chatId, { status: "error" })
      return null
    }
    const ensured: EnsuredDraftSandbox = {
      chatId,
      sandboxId: data.sandboxId,
      branch: data.branch ?? null,
      previewUrlPattern: data.previewUrlPattern ?? null,
    }

    patchChatCache(queryClient, chatId, {
      sandboxId: ensured.sandboxId,
      branch: ensured.branch ?? undefined,
      previewUrlPattern: ensured.previewUrlPattern ?? undefined,
      status: "ready",
    })

    return ensured
  } catch (err) {
    console.error("[sandbox-client] Failed to ensure sandbox for materialized draft:", err)
    patchChatCache(queryClient, chatId, { status: "error" })
    return null
  }
}

/**
 * Materialize a draft chat (if `materializeDraft` resolves it), then ensure
 * the resulting chat has a running sandbox. Returns `null` if either step
 * fails.
 *
 * Owns the "Starting sandbox…" / "Couldn't start sandbox" toast pair for all
 * call sites (useSandboxActions, usePaletteProps, useGitDialogs) so they get
 * consistent UX for free instead of each re-implementing it. `failureBody`
 * lets a caller customize the failure toast's body text (e.g. the Merge
 * dialog's "Merge not performed — try again.").
 *
 * Callers that want the draft→real-chat screen transition to happen before
 * the sandbox finishes booting (e.g. opening the Terminal panel) should use
 * `materializeDraftChat` + `ensureSandboxForChat` directly instead, so they
 * can act on the chat id as soon as it's materialized.
 */
export async function materializeAndEnsureSandbox(
  draftId: string,
  materializeDraft: (draftId: string, options?: { status?: Chat["status"] }) => Promise<{ id: string } | null>,
  queryClient: QueryClient,
  pendingEnv?: PendingEnv,
  options?: { failureBody?: string },
  pendingMcp?: PendingMcp
): Promise<EnsuredDraftSandbox | null> {
  useToastStore.getState().addToast({ title: "Starting sandbox…", body: "This only takes a moment." })

  const chatId = await materializeDraftChat(draftId, materializeDraft, pendingEnv, pendingMcp)
  const result = chatId ? await ensureSandboxForChat(chatId, queryClient) : null

  if (!result) {
    useToastStore.getState().addToast({
      title: "Couldn't start sandbox",
      body: options?.failureBody ?? "Try again.",
    })
  }

  return result
}
