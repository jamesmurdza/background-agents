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
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string
  uploadedFiles: string[]
}

/** The authorized chat row, as returned (non-null) by {@link getChatWithAuth}. */
export type ChatRecord = NonNullable<Awaited<ReturnType<typeof getChatWithAuth>>>
