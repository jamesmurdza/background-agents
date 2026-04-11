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

/**
 * Result of checking rebase/merge status
 */
export interface GitStatusResult {
  inRebase: boolean
  inMerge: boolean
  conflictedFiles: string[]
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  success: boolean
  conflict?: boolean
  inMerge?: boolean
  conflictedFiles?: string[]
  targetBranch?: string
  currentBranch?: string
  message?: string
  error?: string
}

/**
 * Result of a rebase operation
 */
export interface RebaseResult {
  success: boolean
  conflict?: boolean
  conflictedFiles?: string[]
  targetBranch?: string
  message?: string
  error?: string
}

/**
 * Options for git operations that need sandbox access
 */
export interface GitOperationContext {
  sandboxId: string
  repoPath: string
  repoOwner: string
  repoApiName: string
  githubToken: string
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

// =============================================================================
// Git Command Helpers
// =============================================================================

/**
 * Check if a git message indicates nothing to commit
 */
export function isGitNothingToCommitMessage(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  return (
    lowerMessage.includes("nothing to commit") ||
    lowerMessage.includes("no changes added to commit") ||
    lowerMessage.includes("working tree clean")
  )
}

/**
 * Parse conflicted files from git diff output
 */
export function parseConflictedFiles(diffOutput: string): string[] {
  return diffOutput
    .trim()
    .split("\n")
    .filter(Boolean)
}

/**
 * Default empty conflict state
 */
export const EMPTY_CONFLICT_STATE: RebaseConflictState = {
  inRebase: false,
  inMerge: false,
  conflictedFiles: [],
}
