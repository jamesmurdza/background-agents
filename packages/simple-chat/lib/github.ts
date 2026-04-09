/**
 * GitHub API client for Simple Chat
 */

import type { GitHubRepo, GitHubBranch, GitHubUser } from "./types"

const GITHUB_API = "https://api.github.com"

/**
 * Fetch the authenticated user
 */
export async function fetchUser(token: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch repositories for the authenticated user
 */
export async function fetchRepos(token: string): Promise<GitHubRepo[]> {
  const response = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator,organization_member`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch repos: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch branches for a repository
 */
export async function fetchBranches(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch branches: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Push commits to remote
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
