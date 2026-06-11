/**
 * Git operation types and utilities
 * Shared between web and simple-chat packages
 */

// =============================================================================
// Types
// =============================================================================

/**
 * State representing an in-progress rebase or merge with conflicts
 */
export interface RebaseConflictState {
  inRebase: boolean
  inMerge: boolean
  conflictedFiles: string[]
}

// =============================================================================
// PR Generation Utilities
// =============================================================================

/**
 * Generate a simple PR title from a branch name
 * Converts branch names like "feat/add-dark-mode" to "Add dark mode"
 */
export function formatPRTitleFromBranch(branchName: string): string {
  return branchName
    .replace(/^(feat|fix|refactor|docs|test|chore)\//, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
}

/**
 * Generate a simple PR body from commit messages
 */
export function formatPRBodyFromCommits(commits: string[]): string {
  if (commits.length === 0) {
    return "Automated PR"
  }
  return commits.map((c) => `- ${c}`).join("\n")
}

/**
 * Default empty conflict state
 */
export const EMPTY_CONFLICT_STATE: RebaseConflictState = {
  inRebase: false,
  inMerge: false,
  conflictedFiles: [],
}
