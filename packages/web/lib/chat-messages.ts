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

/** The turn started: an agent session exists and the client streams it. */
export interface SendMessageStarted {
  status: "started"
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string
  uploadedFiles: string[]
}

/**
 * The environment's setup script is still running, so the turn is held.
 *
 * The user's message is already persisted server-side and the agent turn is
 * dispatched later (by the /setup SSE endpoint, or by the agent-lifecycle cron
 * if this client is gone), with an assistant message id the server mints
 * itself. So there is no `backgroundSessionId` to stream and nothing for the
 * client's optimistic assistant placeholder to become.
 */
export interface SendMessageSettingUp {
  status: "setting_up"
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  uploadedFiles: string[]
}

/**
 * Discriminated on purpose: the held-turn body carries no
 * `backgroundSessionId` and no `uploadedFiles` guarantee shared with the
 * started body, and treating the two alike is how the first send on a chat with
 * a setup script used to die with a TypeError inside the cache updater. Every
 * consumer has to say which one it is handling.
 */
export type SendMessageResponse = SendMessageStarted | SendMessageSettingUp

export type SendMessageResult =
  | { ok: true; data: SendMessageResponse }
  | {
      ok: false
      error: string
      isDailyLimit: boolean
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
      provider: err.provider,
      creditBalance: typeof err.creditBalance === "number" ? err.creditBalance : undefined,
    }
  }

  const body = (await response.json()) as Partial<SendMessageResponse>
  // A body with no `status` is a started turn: the field was added alongside
  // the held-turn variant, and a client loaded just before that deploy can
  // still be talking to a server from just after it (and vice versa).
  const data = (
    body.status === "setting_up" ? body : { ...body, status: "started" }
  ) as SendMessageResponse
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
  data: SendMessageStarted,
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

/**
 * Apply a held-turn response: the sandbox is up but the setup script is still
 * running, so no turn has started.
 *
 * Drops the optimistic assistant placeholder. The server deliberately persists
 * no assistant row for a held turn (one would make `buildAgentHistory` read the
 * chat as already answered) and the dispatcher mints its own id when the turn
 * finally starts, so keeping the placeholder would leave an empty bubble
 * sitting under the setup log until the reload after setup, and then a second
 * one next to the real reply.
 *
 * `status: "setting_up"` is what mounts the SetupBlock and what keeps the
 * composer from sending again into a 409.
 */
export function applySetupHeld(
  chat: Chat,
  data: SendMessageSettingUp,
  agent: string,
  model: string,
  userMessageId: string,
  assistantMessageId: string
): Chat {
  return {
    ...chat,
    sandboxId: data.sandboxId,
    branch: data.branch,
    previewUrlPattern: data.previewUrlPattern ?? undefined,
    agent,
    model,
    status: "setting_up",
    messages: chat.messages
      .filter((m) => m.id !== assistantMessageId)
      .map((m) =>
        m.id === userMessageId && data.uploadedFiles.length > 0
          ? { ...m, uploadedFiles: data.uploadedFiles }
          : m
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

