/**
 * Branch-related utility functions
 * Provides helpers for branch name generation and validation
 */

import { BRANCH_NAME_WORDS } from "./constants"

/**
 * Generates a random branch name using three hyphen-separated words
 * Example output: "swift-lunar-amber"
 */
export function randomBranchName(): string {
  const pick = () =>
    BRANCH_NAME_WORDS[Math.floor(Math.random() * BRANCH_NAME_WORDS.length)]
  return `${pick()}-${pick()}-${pick()}`
}

/**
 * Validation errors for branch names
 */
export const BRANCH_NAME_ERRORS = {
  HAS_SPACES: "Branch name cannot contain spaces",
  INVALID_CHARACTERS: "Branch name contains invalid characters",
  INVALID_FORMAT: "Invalid branch name format",
  INVALID_SEQUENCE: "Branch name contains invalid sequence",
  ALREADY_EXISTS: "A branch with this name already exists",
  ALREADY_EXISTS_REMOTE: "A branch with this name already exists on GitHub",
} as const

export type BranchNameError = (typeof BRANCH_NAME_ERRORS)[keyof typeof BRANCH_NAME_ERRORS]

/**
 * Validates a branch name according to Git naming rules
 * Returns an error message if invalid, or null if valid
 */
export function validateBranchName(
  branchName: string,
  existingBranches: string[] = [],
  remoteBranches: string[] = []
): BranchNameError | null {
  // Check for spaces
  if (/\s/.test(branchName)) {
    return BRANCH_NAME_ERRORS.HAS_SPACES
  }

  // Check for invalid characters: ~ ^ : ? * [ \
  if (/[~^:?*\[\\]/.test(branchName)) {
    return BRANCH_NAME_ERRORS.INVALID_CHARACTERS
  }

  // Check for invalid format (starts with - or ., ends with . or .lock)
  if (
    branchName.startsWith("-") ||
    branchName.startsWith(".") ||
    branchName.endsWith(".") ||
    branchName.endsWith(".lock")
  ) {
    return BRANCH_NAME_ERRORS.INVALID_FORMAT
  }

  // Check for invalid sequences (.. or @{)
  if (branchName.includes("..") || branchName.includes("@{")) {
    return BRANCH_NAME_ERRORS.INVALID_SEQUENCE
  }

  // Check for duplicates in local branches
  if (existingBranches.includes(branchName)) {
    return BRANCH_NAME_ERRORS.ALREADY_EXISTS
  }

  // Check for duplicates in remote branches
  if (remoteBranches.includes(branchName)) {
    return BRANCH_NAME_ERRORS.ALREADY_EXISTS_REMOTE
  }

  return null
}
