/**
 * State utility functions for immutable updates to nested repo/branch/message structures.
 * These utilities eliminate repeated patterns of mapping through repos and branches.
 */

import type { TransformedRepo } from "@/lib/db-types"
import type { Branch, Message } from "@/lib/types"

// =============================================================================
// Branch Update Utilities
// =============================================================================

/**
 * Updates a specific branch within a specific repo
 * Returns a new array with the updated repo/branch
 */
export function updateBranchInRepo(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string,
  updates: Partial<Branch>
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return {
      ...repo,
      branches: repo.branches.map((branch) =>
        branch.id === branchId ? { ...branch, ...updates } : branch
      ),
    }
  })
}

/**
 * Updates a branch across all repos (when you don't know which repo it belongs to)
 */
export function updateBranchAcrossRepos(
  repos: TransformedRepo[],
  branchId: string,
  updates: Partial<Branch>
): TransformedRepo[] {
  return repos.map((repo) => ({
    ...repo,
    branches: repo.branches.map((branch) =>
      branch.id === branchId ? { ...branch, ...updates } : branch
    ),
  }))
}

/**
 * Adds a new branch to a specific repo
 */
export function addBranchToRepo(
  repos: TransformedRepo[],
  repoId: string,
  branch: Branch
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return { ...repo, branches: [...repo.branches, branch] }
  })
}

/**
 * Removes a branch from a specific repo
 */
export function removeBranchFromRepo(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return {
      ...repo,
      branches: repo.branches.filter((branch) => branch.id !== branchId),
    }
  })
}

/**
 * Replaces all branches in a repo with new branches
 */
export function setBranchesInRepo(
  repos: TransformedRepo[],
  repoId: string,
  branches: Branch[]
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return { ...repo, branches }
  })
}

// =============================================================================
// Message Update Utilities
// =============================================================================

/**
 * Updates a specific message within a specific branch and repo
 */
export function updateMessageInBranch(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string,
  messageId: string,
  updates: Partial<Message>
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return {
      ...repo,
      branches: repo.branches.map((branch) => {
        if (branch.id !== branchId) return branch
        return {
          ...branch,
          messages: branch.messages.map((message) =>
            message.id === messageId ? { ...message, ...updates } : message
          ),
        }
      }),
    }
  })
}

/**
 * Adds a message to a specific branch
 */
export function addMessageToBranch(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string,
  message: Message
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return {
      ...repo,
      branches: repo.branches.map((branch) => {
        if (branch.id !== branchId) return branch
        return {
          ...branch,
          messages: [...branch.messages, message],
        }
      }),
    }
  })
}

/**
 * Sets all messages for a specific branch
 */
export function setMessagesInBranch(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string,
  messages: Message[]
): TransformedRepo[] {
  return repos.map((repo) => {
    if (repo.id !== repoId) return repo
    return {
      ...repo,
      branches: repo.branches.map((branch) => {
        if (branch.id !== branchId) return branch
        return { ...branch, messages }
      }),
    }
  })
}

/**
 * Replaces a message ID (used when optimistic ID is replaced with DB ID)
 */
export function replaceMessageId(
  repos: TransformedRepo[],
  repoId: string,
  branchId: string,
  oldId: string,
  newId: string
): TransformedRepo[] {
  return updateMessageInBranch(repos, repoId, branchId, oldId, { id: newId })
}

/**
 * Removes a repo from the list
 */
export function removeRepo(
  repos: TransformedRepo[],
  repoId: string
): TransformedRepo[] {
  return repos.filter((repo) => repo.id !== repoId)
}

/**
 * Reorders repos (for drag and drop)
 */
export function reorderRepos(
  repos: TransformedRepo[],
  fromIndex: number,
  toIndex: number
): TransformedRepo[] {
  const result = [...repos]
  const [moved] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, moved)
  return result
}
