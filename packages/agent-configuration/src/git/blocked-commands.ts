/**
 * Git commands that are blocked across all agents.
 *
 * These operations are dangerous in an automated agent context because they:
 * - Rewrite history (amend, rebase, reset --hard)
 * - Push changes (handled automatically by the platform)
 * - Manipulate branches (delete, rename, create, switch)
 */

/**
 * Categories of blocked git operations with explanations.
 */
export const BLOCKED_GIT_OPERATIONS = {
  /** History rewriting commands */
  historyRewrite: {
    "git commit --amend": "Rewrites the last commit. Create a new commit instead.",
    "git rebase": "Rewrites commit history. Not allowed.",
    "git reset --hard": "Discards commits and changes. Not allowed.",
  },

  /** Push operations (handled by platform) */
  push: {
    "git push": "Pushing is handled automatically by the platform.",
  },

  /** Branch manipulation */
  branchManipulation: {
    "git branch -d/-D": "Deleting branches is not allowed.",
    "git branch -m/-M": "Renaming branches is not allowed.",
    "git checkout -b": "Creating new branches is not allowed.",
    "git switch -c": "Creating new branches is not allowed.",
    "git checkout <branch>": "Switching branches is not allowed. Stay on the current branch.",
    "git switch <branch>": "Switching branches is not allowed. Stay on the current branch.",
  },
} as const

/**
 * Flattened list of all blocked command patterns for documentation/display.
 */
export const ALL_BLOCKED_COMMANDS = [
  // History rewriting
  "git commit --amend",
  "git rebase",
  "git reset --hard",
  // Push
  "git push",
  // Branch deletion
  "git branch -d",
  "git branch -D",
  // Branch renaming
  "git branch -m",
  "git branch -M",
  // Branch creation
  "git checkout -b",
  "git switch -c",
  // Branch switching
  "git checkout <branch>",
  "git switch <branch>",
] as const

export type BlockedGitCommand = (typeof ALL_BLOCKED_COMMANDS)[number]
