/**
 * GitHub API client for Simple Chat
 *
 * All functions call server-side proxy routes — the GitHub token never
 * leaves the server. The proxy routes fetch the token from the DB.
 */

import type {
  GitHubUser,
  GitHubRepo,
  GitHubBranch,
} from "@upstream/common"

// Re-export types for convenience
export type { GitHubUser, GitHubRepo, GitHubBranch }

/**
 * Fetch repositories for the authenticated user (100 most recent).
 * Calls GET /api/github/repos which reads the token from DB server-side.
 */
export async function fetchRepos(): Promise<GitHubRepo[]> {
  const res = await fetch("/api/github/repos")
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || "Failed to fetch repos")
  }
  const data = await res.json()
  return data.repos
}

/**
 * Fetch a single repository.
 * Calls GET /api/github/repo which reads the token from DB server-side.
 */
export async function fetchRepo(
  owner: string,
  repo: string
): Promise<GitHubRepo> {
  const res = await fetch(`/api/github/repo?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || "Failed to fetch repo")
  }
  const data = await res.json()
  return data.repo
}

/**
 * Fetch branches for a repository.
 * Calls GET /api/github/branches which reads the token from DB server-side.
 */
export async function fetchBranches(
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  const res = await fetch(`/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || "Failed to fetch branches")
  }
  const data = await res.json()
  return data.branches
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

/**
 * Fork a repository to the authenticated user's account.
 * Calls POST /api/github/fork which handles the fork operation server-side.
 */
export async function forkRepository(
  owner: string,
  repo: string
): Promise<GitHubRepo> {
  const response = await fetch("/api/github/fork", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ owner, repo }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to fork repository")
  }

  return response.json()
}

/**
 * Parse a GitHub URL to extract owner and repo name.
 * Supports formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - github.com/owner/repo
 * - owner/repo
 * Returns null if the URL is not a valid GitHub repository reference.
 */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim()

  // Try to extract owner/repo from various formats
  // Full URLs: https://github.com/owner/repo with optional .git suffix and optional path
  const urlPattern = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?(?:\/.*)?$/i
  const urlMatch = trimmed.match(urlPattern)
  if (urlMatch) {
    // Clean up repo name (remove .git if present at end)
    let repo = urlMatch[2]
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4)
    }
    return { owner: urlMatch[1], repo }
  }

  // Short format: owner/repo (no slashes before or after)
  // Owner: starts with alphanumeric, can contain hyphens
  // Repo: can contain alphanumerics, dots, hyphens, underscores
  const shortPattern = /^([a-zA-Z0-9][-a-zA-Z0-9]*)\/([a-zA-Z0-9._-]+)$/
  const shortMatch = trimmed.match(shortPattern)
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] }
  }

  return null
}
