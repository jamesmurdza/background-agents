/**
 * Pure functions for message merging and conflict resolution.
 *
 * Extracted from use-sync-data.ts to enable unit testing.
 * These handle the tricky case of syncing messages while streaming is in progress.
 */

// =============================================================================
// Types
// =============================================================================

/** Minimal message interface for merging. Allows extra properties. */
export interface MessageLike {
  id: string
  content?: string
  toolCalls?: unknown[]
  contentBlocks?: unknown[]
  // Allow additional properties from the full Message type
  [key: string]: unknown
}

export interface ApiMessage {
  id: string
  role: string
  content: string
  toolCalls?: unknown[]
  contentBlocks?: unknown[]
  timestamp?: string
  commitHash?: string | null
  commitMessage?: string | null
}

// =============================================================================
// Pure Functions
// =============================================================================

/**
 * Determines if the local message is "richer" than the API message.
 *
 * A message is considered richer if it has more content, more tool calls,
 * or more content blocks. This is used to prevent sync from overwriting
 * in-progress or just-finished streamed content with stale DB data.
 *
 * @param local - The local (potentially streaming) message
 * @param api - The message from the API/database
 * @returns true if local message should be kept over API message
 */
export function isLocalRicher(
  local: MessageLike,
  api: { content?: string; toolCalls?: unknown[]; contentBlocks?: unknown[] }
): boolean {
  // Compare content length
  const localContentLength = local.content?.length ?? 0
  const apiContentLength = api.content?.length ?? 0
  if (localContentLength > apiContentLength) return true

  // Compare tool calls count
  const localToolCalls = local.toolCalls?.length ?? 0
  const apiToolCalls = api.toolCalls?.length ?? 0
  if (localToolCalls > apiToolCalls) return true

  // Compare content blocks count
  const localBlocks = local.contentBlocks?.length ?? 0
  const apiBlocks = api.contentBlocks?.length ?? 0
  if (localBlocks > apiBlocks) return true

  return false
}

/**
 * Converts an API message to the local message format.
 */
export function convertApiMessage<T extends ApiMessage>(apiMessage: T): MessageLike {
  return {
    id: apiMessage.id,
    role: apiMessage.role as 'user' | 'assistant',
    content: apiMessage.content,
    toolCalls: apiMessage.toolCalls,
    contentBlocks: apiMessage.contentBlocks,
    timestamp: apiMessage.timestamp || '',
    commitHash: apiMessage.commitHash || undefined,
    commitMessage: apiMessage.commitMessage || undefined,
  }
}

/**
 * Merges API messages with local messages, handling conflicts.
 *
 * Strategy:
 * 1. For messages present in both local and API, keep the "richer" version
 *    (the one with more content/tool calls/blocks)
 * 2. Keep optimistic local messages that don't exist in API yet
 * 3. Return in chronological order
 *
 * @param localMessages - Current local messages (may include streaming content)
 * @param apiMessages - Messages from the API/database
 * @returns Merged messages array
 */
export function mergeMessages<T extends ApiMessage>(
  localMessages: MessageLike[],
  apiMessages: T[]
): MessageLike[] {
  // Convert API messages
  const convertedApiMessages = apiMessages.map(convertApiMessage)

  // Build lookup maps
  const localById = new Map(localMessages.map((m) => [m.id, m]))
  const apiMessageIds = new Set(convertedApiMessages.map((m) => m.id))

  // Find optimistic messages (local only, not in API yet)
  const optimisticMessages = localMessages.filter((m) => !apiMessageIds.has(m.id))

  // Merge: for each API message, keep local if richer
  const merged = convertedApiMessages.map((apiMsg) => {
    const local = localById.get(apiMsg.id)
    if (local && isLocalRicher(local, apiMsg)) {
      return local
    }
    return apiMsg
  })

  // Append optimistic messages at the end
  return [...merged, ...optimisticMessages]
}

/**
 * Determines if a sync should be skipped.
 *
 * Sync should be skipped when:
 * 1. A message is currently being streamed (streamingMessageId is set)
 * 2. The branch being synced is the active branch (we don't want to overwrite streaming)
 *
 * @param streamingMessageId - ID of currently streaming message, or null
 * @param syncBranchId - ID of branch being synced
 * @param activeBranchId - ID of currently active branch
 * @returns true if sync should be skipped
 */
export function shouldSkipSync(
  streamingMessageId: string | null,
  syncBranchId: string,
  activeBranchId: string | null
): boolean {
  // If not streaming, don't skip
  if (!streamingMessageId) return false

  // If streaming but not on this branch, don't skip
  if (syncBranchId !== activeBranchId) return false

  // Streaming on the active branch - skip to prevent overwrite
  return true
}

/**
 * Determines which messages need to be updated after a sync.
 *
 * Used for detecting new messages from other devices.
 *
 * @param previousLastMessageId - The last known message ID before sync
 * @param currentLastMessageId - The latest message ID from sync
 * @returns true if there are new messages
 */
export function hasNewMessages(
  previousLastMessageId: string | null,
  currentLastMessageId: string | null
): boolean {
  return (
    currentLastMessageId !== null &&
    currentLastMessageId !== previousLastMessageId
  )
}
