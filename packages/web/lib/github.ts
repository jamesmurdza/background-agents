/**
 * GitHub API client for Simple Chat
 * Re-exports shared utilities from @upstream/common
 */

import {
  getUser,
  getUserRepos,
  getRepo,
  getRepoBranches,
  searchRepos,
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
 * Fetch repositories for the authenticated user (most recent 100)
 * For finding older repos, use fetchSearchRepos which searches across all repos
 */
export async function fetchRepos(token: string): Promise<GitHubRepo[]> {
  return getUserRepos(token, {
    sort: "updated",
    perPage: 100,
    affiliation: "owner,collaborator,organization_member",
  })
}

/**
 * Fetch a single repository
 */
export async function fetchRepo(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubRepo> {
  return getRepo(token, owner, repo)
}

/**
 * Fetch branches for a repository
 */
export async function fetchBranches(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  return getRepoBranches(token, owner, repo, { perPage: 100, paginate: true })
}

/**
 * Search repositories using GitHub's Search API
 * This searches across ALL accessible repos, not just the most recent ones
 */
export async function fetchSearchRepos(
  token: string,
  query: string
): Promise<GitHubRepo[]> {
  return searchRepos(token, query, { perPage: 50 })
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

/**
 * Create a new GitHub repository (simple-chat specific - calls local API)
 */
export async function createRepository(options: {
  name: string
  description?: string
  isPrivate?: boolean
}): Promise<GitHubRepo> {
  const response = await fetch("/api/github/create-repo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to create repository")
  }

  return response.json()
}
