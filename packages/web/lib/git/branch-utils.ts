/**
 * Branch-related utility functions
 * Re-exports shared utilities from @upstream/common
 */

// Re-export everything from common
export {
  BRANCH_NAME_WORDS,
  BRANCH_NAME_ERRORS,
  type BranchNameWord,
  type BranchNameError,
  type BranchNameOptions,
  generateBranchName,
  randomBranchName,
  validateBranchName,
} from "@upstream/common"
