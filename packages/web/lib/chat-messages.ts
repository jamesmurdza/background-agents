// Message-send API contract + pure transforms used by sendMessage.
//
// Extracted from useChatWithSync. The cache-update transforms here are the
// fiddly "given a chat, produce the next chat" steps of an optimistic send
// (apply, roll back, succeed, error) plus the agent/model resolution and the
// shared-pool predicate. They're pure and deterministic, so they're unit-tested
// in chat-messages.test.ts instead of being buried inline in the hook.

import type { Chat, Message, CredentialFlags } from "@/lib/types"
import { sharedClaudePoolEligible } from "@/lib/types"
import type { SettingsData } from "@/lib/query"
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
      resetAt?: string
      /** Shared-pool provider that hit its limit (claude | gemini | opencode). */
      provider?: string
      /** Unit the budget is measured in (tokens | cost | messages). */
      unit?: "tokens" | "cost" | "messages"
      /** Amount used / daily budget for that provider, in `unit`, from the 429 body. */
      used?: number
      limit?: number
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
      resetAt: err.resetAt,
      provider: err.provider,
      unit: err.unit,
      used: err.used,
      limit: err.limit,
    }
  }

  const data = (await response.json()) as SendMessageResponse
  return { ok: true, data }
}

// =============================================================================
// Pure resolution helpers
// =============================================================================

/**
 * Whether this send draws from the shared Claude pool (Claude Code, no personal
 * Anthropic credentials, shared pool available) — used to optimistically
 * decrement the usage counter.
 */
export function usesSharedClaudePool(agent: string, flags: CredentialFlags): boolean {
  return agent === "claude-code" && sharedClaudePoolEligible(flags)
}

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
    lastActiveAt: now,
    errorMessage: undefined,
    errorKind: undefined,
  }
}

/** Roll back the optimistic messages and return the chat to ready (e.g. on daily-limit). */
export function removeOptimisticMessages(chat: Chat, messageIds: string[]): Chat {
  const ids = new Set(messageIds)
  return {
    ...chat,
    status: "ready",
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
    errorMessage,
    messages: chat.messages.map((m) =>
      m.id === assistantMessageId
        ? { ...m, content: `Error: ${errorMessage}`, messageType: "error", isError: true }
        : m
    ),
  }
}

/** Optimistically decrement the shared-pool Claude usage counter. No-op if unknown. */
export function decrementClaudeUsage(old: SettingsData | undefined): SettingsData | undefined {
  if (!old || old.claudeLimitUsed === null || old.claudeLimitUsed === undefined) return old
  return {
    ...old,
    claudeLimitUsed: old.claudeLimitUsed + 1,
    claudeLimitRemaining:
      old.claudeLimitRemaining !== null && old.claudeLimitRemaining !== undefined
        ? Math.max(0, old.claudeLimitRemaining - 1)
        : null,
  }
}
