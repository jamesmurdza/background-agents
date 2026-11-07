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

/**
 * Materialize a draft chat (if `materializeDraft` resolves it) and apply any
 * env vars staged on it (see `DraftChatConfig.pendingEnvironmentVariables` in
 * lib/storage.ts, written by the Env Vars modal while a chat is still a
 * draft) — best-effort, a failure here doesn't block the caller's actual
 * action. Returns the real chat id, or `null` if materializing failed.
 *
 * Split out from `ensureSandboxForChat` so callers that want to flip the UI
 * from the draft/welcome screen to the real chat screen immediately (e.g.
 * opening the Terminal panel) don't have to wait for the sandbox to finish
 * booting first — only for this fast step.
 */
export async function materializeDraftChat(
  draftId: string,
  materializeDraft: (draftId: string) => Promise<{ id: string } | null>,
  pendingEnv?: PendingEnv
): Promise<string | null> {
  const materialized = await materializeDraft(draftId)
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

  return chatId
}

/**
 * Hit `/api/chats/[chatId]/sandbox/ensure` to make sure the chat has a
 * running sandbox, then patch the result into the TanStack Query chat cache
 * (both the list and detail query keys — same shape `useCreateChatMutation`
 * writes) so every consumer of the cached chat object (not just whoever
 * awaited this call) picks up the new `sandboxId`/`branch`/`previewUrlPattern`
 * on its next render, instead of waiting for an unrelated background
 * refetch to backfill it.
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
      return null
    }
    const ensured: EnsuredDraftSandbox = {
      chatId,
      sandboxId: data.sandboxId,
      branch: data.branch ?? null,
      previewUrlPattern: data.previewUrlPattern ?? null,
    }

    const patch = (chat: Chat): Chat => ({
      ...chat,
      sandboxId: ensured.sandboxId,
      branch: ensured.branch ?? chat.branch,
      previewUrlPattern: ensured.previewUrlPattern ?? chat.previewUrlPattern ?? undefined,
    })
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (old) =>
      old?.map((c) => (c.id === chatId ? patch(c) : c))
    )
    queryClient.setQueryData<Chat>(queryKeys.chats.detail(chatId), (old) =>
      old ? patch(old) : old
    )

    return ensured
  } catch (err) {
    console.error("[sandbox-client] Failed to ensure sandbox for materialized draft:", err)
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
  materializeDraft: (draftId: string) => Promise<{ id: string } | null>,
  queryClient: QueryClient,
  pendingEnv?: PendingEnv,
  options?: { failureBody?: string }
): Promise<EnsuredDraftSandbox | null> {
  useToastStore.getState().addToast({ title: "Starting sandbox…", body: "This only takes a moment." })

  const chatId = await materializeDraftChat(draftId, materializeDraft, pendingEnv)
  const result = chatId ? await ensureSandboxForChat(chatId, queryClient) : null

  if (!result) {
    useToastStore.getState().addToast({
      title: "Couldn't start sandbox",
      body: options?.failureBody ?? "Try again.",
    })
  }

  return result
}
