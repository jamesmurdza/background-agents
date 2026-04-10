/**
 * GitHub API client for Simple Chat
 * Re-exports shared utilities from @upstream/common
 */

import {
  getUser,
  getUserRepos,
  getRepoBranches,
  type GitHubUser,
  type GitHubRepo,
  type GitHubBranch,
} from "@upstream/common"

// Re-export types for convenience
export type { GitHubUser, GitHubRepo, GitHubBranch }

/**
 * Fetch the authenticated user
 */
export async function fetchUser(token: string): Promise<GitHubUser> {
  return getUser(token)
}

/**
 * Fetch repositories for the authenticated user
 */
export async function fetchRepos(token: string): Promise<GitHubRepo[]> {
  return getUserRepos(token, {
    sort: "updated",
    perPage: 50,
    affiliation: "owner,collaborator,organization_member",
  })
}

/**
 * Fetch branches for a repository
 */
export async function fetchBranches(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  return getRepoBranches(token, owner, repo, { perPage: 100, paginate: false })
}

/**
 * Push commits to remote (simple-chat specific - calls local API)
 */
export async function pushToRemote(
  sandboxId: string,
  repoName: string,
  branch: string
): Promise<void> {
  const response = await fetch("/api/git/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sandboxId, repoName, branch }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || "Failed to push to remote")
  }
}
