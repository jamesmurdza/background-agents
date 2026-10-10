// Message-send API contract + pure transforms used by sendMessage.
//
// Extracted from useChatWithSync. The cache-update transforms here are the
// fiddly "given a chat, produce the next chat" steps of an optimistic send
// (apply, roll back, succeed, error) plus the agent/model resolution. They're
// pure and deterministic, so they're unit-tested
// in chat-messages.test.ts instead of being buried inline in the hook.

import type { Chat, Message } from "@/lib/types"
import { generateBranchName } from "@/lib/utils"

// =============================================================================
// API contract
// =============================================================================

export interface SendMessagePayload {
  message: string
  agent: string
  model: string
  userMessageId: string
  assistantMessageId: string
  newBranch?: string
  planMode?: boolean
}

export interface SendMessageResponse {
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string
  uploadedFiles: string[]
}

export type SendMessageResult =
  | { ok: true; data: SendMessageResponse }
  | {
      ok: false
      error: string
      isDailyLimit: boolean
      /** The server did not accept or persist this turn because another turn won the claim. */
      isChatBusy?: boolean
      /** Shared-pool provider that hit its limit (claude | gemini | opencode). */
      provider?: string
      /**
       * Purchased credits in USD, from the 429 body. Negative when the turn
       * that emptied them overshot. This is what gates a send — see
       * lib/db/usage-limit — so it's what the dialog explains.
       */
      creditBalance?: number | null
    }
  | {
      ok: false
      isPullConflict: true
      error: string
      conflictedFiles: string[]
      branch: string | null
    }

/**
 * Send a message to the API, handling both JSON and FormData (for files).
 */
export async function sendMessageToApi(
  chatId: string,
  payload: SendMessagePayload,
  files?: File[]
): Promise<SendMessageResult> {
  let response: Response

  if (files?.length) {
    const formData = new FormData()
    formData.append("payload", JSON.stringify(payload))
    files.forEach((file, i) => formData.append(`file-${i}`, file))
    response = await fetch(`/api/chats/${chatId}/messages`, { method: "POST", body: formData })
  } else {
    response = await fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  }

  if (!response.ok) {
    // Vercel serverless functions reject request bodies over 4.5 MB with a 413
    // *before* the route runs, so the body is a non-JSON edge error page. Map it
    // to a clear message (the client-side guard in useFileUpload should catch
    // this first, but this covers any edge case that slips through).
    if (response.status === 413) {
      return {
        ok: false,
        error: "Attachments are too large to upload (max ~4 MB total). Remove or shrink files and try again.",
        isDailyLimit: false,
      }
    }
    const err = await response.json().catch(() => ({}))

    // Pre-run auto-pull conflict — the caller surfaces the existing
    // merge-conflict UI (the merge is left in progress in the sandbox).
    if (response.status === 409 && err.error === "PULL_CONFLICT") {
      return {
        ok: false,
        isPullConflict: true,
        error: "PULL_CONFLICT",
        conflictedFiles: Array.isArray(err.conflictedFiles) ? err.conflictedFiles : [],
        branch: err.branch ?? null,
      }
    }

    return {
      ok: false,
      // Surface the HTTP status when the server didn't return a JSON error
      // message, so failures like 500/502/504 are identifiable instead of
      // collapsing into a bare "Failed to send message".
      error: err.error || `Failed to send message (HTTP ${response.status})`,
      isDailyLimit: err.error === "DAILY_LIMIT_EXCEEDED",
      isChatBusy: response.status === 409 && err.error === "Chat is busy",
      provider: err.provider,
      creditBalance: typeof err.creditBalance === "number" ? err.creditBalance : undefined,
    }
  }

  const data = (await response.json()) as SendMessageResponse
  return { ok: true, data }
}

// =============================================================================
// Pure resolution helpers
// =============================================================================

/** Branch arg for the send payload: a new agent branch unless the sandbox exists. */
export function newBranchForSend(chat: Pick<Chat, "sandboxId">): string | undefined {
  return chat.sandboxId ? undefined : `agent/${generateBranchName()}`
}

// =============================================================================
// Pure optimistic cache transforms: (chat, …) => chat
// =============================================================================

/** Append the optimistic user + assistant messages and move the chat to an active state. */
export function applyOptimisticSend(
  chat: Chat,
  userMessage: Message,
  assistantMessage: Message,
  now: number
): Chat {
  return {
    ...chat,
    messages: [...chat.messages, userMessage, assistantMessage],
    status: chat.sandboxId ? "running" : "creating",
    pendingSend: true,
    pendingSendAssistantMessageId: assistantMessage.id,
    activeAssistantMessageId: assistantMessage.id,
    lastActiveAt: now,
    errorMessage: undefined,
    errorKind: undefined,
  }
}

/** Roll back a rejected attempt without releasing a newer active turn. */
export function removeOptimisticMessages(chat: Chat, messageIds: string[]): Chat {
  const ids = new Set(messageIds)
  const ownsTurn = !!chat.activeAssistantMessageId && ids.has(chat.activeAssistantMessageId)
  const ownsPendingSend = !chat.pendingSendAssistantMessageId || ids.has(chat.pendingSendAssistantMessageId)
  return {
    ...chat,
    ...(ownsTurn ? { status: "ready" as const, activeAssistantMessageId: undefined } : {}),
    ...(ownsPendingSend ? { pendingSend: false, pendingSendAssistantMessageId: undefined } : {}),
    messages: chat.messages.filter((m) => !ids.has(m.id)),
  }
}

/** Apply the server's send response: sandbox/branch/session info + uploaded-file ids. */
export function applySendSuccess(
  chat: Chat,
  data: SendMessageResponse,
  agent: string,
  model: string,
  userMessageId: string
): Chat {
  return {
    ...chat,
    sandboxId: data.sandboxId,
    branch: data.branch,
    previewUrlPattern: data.previewUrlPattern ?? undefined,
    backgroundSessionId: data.backgroundSessionId,
    agent,
    model,
    status: "running",
    pendingSend: false,
    messages: chat.messages.map((m) =>
      m.id === userMessageId && data.uploadedFiles.length > 0 ? { ...m, uploadedFiles: data.uploadedFiles } : m
    ),
  }
}

/** Mark the chat errored and surface the error on the assistant placeholder message. */
export function applySendError(chat: Chat, assistantMessageId: string, errorMessage: string): Chat {
  return {
    ...chat,
    status: "error",
    pendingSend: false,
    activeAssistantMessageId: undefined,
    errorMessage,
    messages: chat.messages.map((m) =>
      m.id === assistantMessageId
        ? { ...m, content: `Error: ${errorMessage}`, messageType: "error", isError: true }
        : m
    ),
  }
}
