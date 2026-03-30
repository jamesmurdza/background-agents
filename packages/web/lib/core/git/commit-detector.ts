/**
 * Pure functions for commit detection and deduplication.
 *
 * Extracted from useExecutionPolling to enable unit testing.
 * These functions have zero dependencies on React or browser APIs.
 */

// =============================================================================
// Types
// =============================================================================

export interface Commit {
  shortHash: string
  message: string
}

/** Minimal message interface for commit detection. Allows extra properties. */
export interface Message {
  id: string
  commitHash?: string
  // Allow additional properties from the full Message type
  [key: string]: unknown
}

// =============================================================================
// Pure Functions
// =============================================================================

/**
 * Extracts commit hashes that are already shown in chat messages.
 * Used for deduplication to avoid showing the same commit twice.
 */
export function getExistingCommitHashes(messages: Message[]): Set<string> {
  return new Set(
    messages
      .filter((m) => m.commitHash)
      .map((m) => m.commitHash as string)
  )
}

/**
 * Filters commits to only include ones that haven't been shown yet.
 *
 * Git log returns commits newest-first, so we stop at the first commit
 * we've already seen to avoid showing out-of-order/repeated commits.
 *
 * @param allCommits - Commits from git log (newest first)
 * @param existingHashes - Set of commit hashes already shown in chat
 * @returns New commits that should be displayed (oldest first for chronological display)
 */
export function filterNewCommits(
  allCommits: Commit[],
  existingHashes: Set<string>
): Commit[] {
  // Find the first commit that's already in chat
  const firstSeenIdx = allCommits.findIndex((c) =>
    existingHashes.has(c.shortHash)
  )

  // Get only commits before the first seen one
  const newCommits =
    firstSeenIdx === -1
      ? allCommits // No overlap - all are new
      : allCommits.slice(0, firstSeenIdx) // Only commits before first seen

  // Return oldest first for chronological display
  return [...newCommits].reverse()
}

/**
 * Determines if there are any new commits to show.
 */
export function hasNewCommits(
  allCommits: Commit[],
  existingHashes: Set<string>
): boolean {
  return filterNewCommits(allCommits, existingHashes).length > 0
}

/**
 * Gets the most recent commit hash from a list.
 * Used to track "last shown commit" for subsequent fetches.
 */
export function getMostRecentCommitHash(commits: Commit[]): string | null {
  return commits.length > 0 ? commits[0].shortHash : null
}

/**
 * Creates a commit message object for display in chat.
 */
export function createCommitMessage(
  commit: Commit,
  generateId: () => string
): Message & { commitHash: string; commitMessage: string } {
  return {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    commitHash: commit.shortHash,
    commitMessage: commit.message,
  }
}

/**
 * Processes commits and returns messages to add to chat.
 *
 * This is a pure composition of the above functions.
 *
 * @param allCommits - Commits from git log (newest first)
 * @param existingMessages - Current chat messages
 * @param generateId - Function to generate unique IDs
 * @returns Array of commit messages to add (oldest first)
 */
export function processCommitsForChat(
  allCommits: Commit[],
  existingMessages: Message[],
  generateId: () => string
): Array<Message & { commitHash: string; commitMessage: string }> {
  const existingHashes = getExistingCommitHashes(existingMessages)
  const newCommits = filterNewCommits(allCommits, existingHashes)

  return newCommits.map((commit) => createCommitMessage(commit, generateId))
}
