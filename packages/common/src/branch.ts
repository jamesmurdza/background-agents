/**
 * Branch name generation and validation utilities
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Word list for generating random branch names
 * Used to create memorable, human-readable branch names like "swift-lunar-amber"
 */
export const BRANCH_NAME_WORDS = [
  "swift",
  "lunar",
  "amber",
  "coral",
  "ember",
  "frost",
  "bloom",
  "spark",
  "drift",
  "pulse",
  "cedar",
  "maple",
  "river",
  "stone",
  "cloud",
  "flame",
  "steel",
  "light",
  "storm",
  "wave",
  "tiger",
  "eagle",
  "brave",
  "vivid",
  "noble",
  "rapid",
  "quiet",
  "sharp",
  "fresh",
  "grand",
] as const

export type BranchNameWord = (typeof BRANCH_NAME_WORDS)[number]

// =============================================================================
// Branch Name Generation
// =============================================================================

/**
 * Pick a random word from the branch name word list
 */
function pickRandomWord(): BranchNameWord {
  return BRANCH_NAME_WORDS[Math.floor(Math.random() * BRANCH_NAME_WORDS.length)]
}

/**
 * Generate a random alphanumeric suffix
 */
function generateSuffix(length: number = 4): string {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length)
}

export interface BranchNameOptions {
  /** Number of words to use (default: 2) */
  wordCount?: number
  /** Whether to include an alphanumeric suffix (default: true) */
  includeSuffix?: boolean
  /** Length of the suffix if included (default: 4) */
  suffixLength?: number
}

/**
 * Generate a random branch name from the word list
 *
 * @example
 * generateBranchName() // "swift-lunar-a1b2"
 * generateBranchName({ wordCount: 3, includeSuffix: false }) // "swift-lunar-amber"
 * generateBranchName({ wordCount: 2, suffixLength: 6 }) // "swift-lunar-a1b2c3"
 */
export function generateBranchName(options: BranchNameOptions = {}): string {
  const { wordCount = 2, includeSuffix = true, suffixLength = 4 } = options

  const words: string[] = []
  for (let i = 0; i < wordCount; i++) {
    words.push(pickRandomWord())
  }

  if (includeSuffix) {
    words.push(generateSuffix(suffixLength))
  }

  return words.join("-")
}

/**
 * Generate a random branch name using three words (no suffix)
 * Convenience function for the "three-word" style: "swift-lunar-amber"
 */
export function randomBranchName(): string {
  return generateBranchName({ wordCount: 3, includeSuffix: false })
}

// =============================================================================
// Branch Name Validation
// =============================================================================

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
 *
 * @param branchName - The branch name to validate
 * @param existingBranches - List of existing local branch names to check for duplicates
 * @param remoteBranches - List of existing remote branch names to check for duplicates
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
