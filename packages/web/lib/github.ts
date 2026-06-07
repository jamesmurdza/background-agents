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
} from "@background-agents/common"

// Re-export types for convenience
export type { GitHubUser, GitHubRepo, GitHubBranch }

interface FetchReposPageResult {
  repos: GitHubRepo[]
  page: number
  hasMore: boolean
}

/**
 * Throw an Error built from a failed proxy response's JSON `error` field,
 * falling back to a generic message when the body is missing or not JSON.
 */
async function throwResponseError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}))
  throw new Error((data as { error?: string }).error || fallback)
}

/**
 * POST a JSON body to a local proxy route and return the parsed JSON response.
 */
async function postJson<T>(url: string, body: unknown, errorFallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) await throwResponseError(res, errorFallback)
  return res.json()
}

/**
 * Fetch a single page of repositories for the authenticated user.
 * Calls GET /api/github/repos which reads the token from DB server-side.
 */
async function fetchReposPage(page: number = 1): Promise<FetchReposPageResult> {
  const res = await fetch(`/api/github/repos?page=${page}`)
  if (!res.ok) await throwResponseError(res, "Failed to fetch repos")
  return res.json()
}

/**
 * Fetch ALL repositories for the authenticated user with progressive loading.
 * Calls onProgress callback after each page is fetched.
 *
 * @param onProgress - Called with accumulated repos and loading status after each page
 * @returns Promise that resolves to all repos when complete
 */
export async function fetchAllRepos(
  onProgress?: (repos: GitHubRepo[], isComplete: boolean) => void
): Promise<GitHubRepo[]> {
  const allRepos: GitHubRepo[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const result = await fetchReposPage(page)
    allRepos.push(...result.repos)
    hasMore = result.hasMore

    // Notify progress
    onProgress?.(allRepos, !hasMore)

    page++
  }

  return allRepos
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
  if (!res.ok) await throwResponseError(res, "Failed to fetch repo")
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
  if (!res.ok) await throwResponseError(res, "Failed to fetch branches")
  const data = await res.json()
  return data.branches
}

/**
 * Create a new GitHub repository (simple-chat specific - calls local API)
 */
export async function createRepository(options: {
  name: string
  description?: string
  isPrivate?: boolean
}): Promise<GitHubRepo> {
  return postJson<GitHubRepo>("/api/github/create-repo", options, "Failed to create repository")
}
