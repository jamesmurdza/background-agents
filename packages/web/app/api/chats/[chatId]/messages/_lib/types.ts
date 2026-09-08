import type { getChatWithAuth } from "@/lib/db/api-helpers"

/** Request body for POST /api/chats/[chatId]/messages. */
export interface MessagePayload {
  message: string
  agent: string
  model: string
  userMessageId: string
  assistantMessageId: string
  /** Branch name for the new sandbox if one is being created. Generated server-side if omitted. */
  newBranch?: string
  /** When true, agent should plan before acting */
  planMode?: boolean
}

/** Success body returned by POST once the agent turn has been kicked off. */
export interface SuccessResponse {
  status: "started"
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string
  uploadedFiles: string[]
}

/**
 * Success body returned by POST when a running setup script is holding the
 * turn. The user's message is already persisted; the agent turn is dispatched
 * later by the /setup SSE endpoint or the agent-lifecycle cron.
 *
 * Carries the sandbox fields even though no turn has started, so the client's
 * cache is already correct when the turn does start: without them the chat
 * would sit with a null sandboxId for the whole setup, and the resume-streaming
 * path keys on sandboxId being present. There is deliberately no
 * `backgroundSessionId` (no session exists yet) and no assistant message id
 * (none is persisted for a held turn, and the dispatcher mints a fresh one).
 */
export interface SetupHeldResponse {
  status: "setting_up"
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  uploadedFiles: string[]
}

/** The authorized chat row, as returned (non-null) by {@link getChatWithAuth}. */
export type ChatRecord = NonNullable<Awaited<ReturnType<typeof getChatWithAuth>>>
