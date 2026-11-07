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

export interface EnsuredDraftSandbox {
  chatId: string
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
}

/**
 * Materialize a draft chat (if `materializeDraft` resolves it), then ensure
 * the resulting chat has a running sandbox. Returns `null` if either step
 * fails — callers should surface their own error UI/toast in that case.
 */
export async function materializeAndEnsureSandbox(
  draftId: string,
  materializeDraft: (draftId: string) => Promise<{ id: string } | null>
): Promise<EnsuredDraftSandbox | null> {
  const materialized = await materializeDraft(draftId)
  if (!materialized) return null

  const chatId = materialized.id
  try {
    const res = await fetch(`/api/chats/${chatId}/sandbox/ensure`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error("[sandbox-client] Failed to ensure sandbox for materialized draft:", data)
      return null
    }
    return {
      chatId,
      sandboxId: data.sandboxId,
      branch: data.branch ?? null,
      previewUrlPattern: data.previewUrlPattern ?? null,
    }
  } catch (err) {
    console.error("[sandbox-client] Failed to ensure sandbox for materialized draft:", err)
    return null
  }
}
