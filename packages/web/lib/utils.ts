/**
 * Utilities for Simple Chat
 * Re-exports from @upstream/common
 */

export { cn, generateBranchName } from "@upstream/common"

import { NEW_REPOSITORY } from "./types"
import type { Chat } from "./types"
import { ALL_REPOSITORIES, NO_REPOSITORY } from "./contexts"

// =============================================================================
// Chat Utilities
// =============================================================================

/**
 * Check if a chat has any messages (either loaded or via server-side count).
 * Used to determine if a chat should be visible in lists/filters.
 */
export function chatHasMessages(chat: Chat): boolean {
  return chat.messages.length > 0 || (chat.messageCount ?? 0) > 0
}

/**
 * Check if a repository string represents the default/new repository.
 * Returns true for NEW_REPOSITORY ("__new__") which indicates no linked GitHub repo.
 */
export function isDefaultRepo(repo: string): boolean {
  return repo === NEW_REPOSITORY
}

/**
 * Get a human-readable display name for a repository.
 * Handles special values like NEW_REPOSITORY, ALL_REPOSITORIES, and NO_REPOSITORY.
 */
export function getRepoDisplayName(repo: string): string {
  if (repo === NEW_REPOSITORY) return "No repository"
  if (repo === ALL_REPOSITORIES) return "All chats"
  if (repo === NO_REPOSITORY) return "No repository"
  return repo
}
