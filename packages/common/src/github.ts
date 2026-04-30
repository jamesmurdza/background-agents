/**
 * GitHub API client utilities
 * Provides a consistent interface for making GitHub API requests
 */

// =============================================================================
// Types
// =============================================================================

export interface GitHubApiError {
  message: string
  status: number
}

export interface GitHubFetchOptions extends Omit<RequestInit, "headers"> {
  /** Custom Accept header (defaults to application/vnd.github.v3+json) */
  accept?: string
}

export interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
  email?: string | null
}

export interface GitHubRepo {
  id?: number
  name: string
  full_name: string
  owner: { login: string; avatar_url?: string }
  default_branch: string
  private: boolean
  description?: string | null
  permissions?: { push: boolean; pull: boolean; admin: boolean }
}

export interface GitHubBranch {
  name: string
  protected?: boolean
}

export interface GitHubCompareResult {
  ahead_by: number
  behind_by: number
  status: "ahead" | "behind" | "diverged" | "identical"
  commits?: Array<{ commit: { message: string } }>
}

export interface GitHubPullRequest {
  html_url: string
  number: number
  title: string
}

// =============================================================================
// Core Fetch Helpers
// =============================================================================

/**
 * Makes a request to the GitHub API with standard headers
 * @param url - Full GitHub API URL or path (will be prefixed with https://api.github.com if relative)
 * @param token - GitHub access token
 * @param options - Fetch options
 * @returns Parsed JSON response
 * @throws GitHubApiError if the request fails
 */
export async function githubFetch<T = unknown>(
  url: string,
  token: string,
  options: GitHubFetchOptions = {}
): Promise<T> {
  const { accept = "application/vnd.github.v3+json", ...fetchOptions } = options

  const fullUrl = url.startsWith("http") ? url : `https://api.github.com${url}`

  const response = await fetch(fullUrl, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
    },
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const message = (data as { message?: string }).message || `GitHub API error: ${response.status}`
    throw { message, status: response.status } as GitHubApiError
  }

  return response.json()
}

/**
 * Type guard to check if an error is a GitHubApiError
 */
export function isGitHubApiError(error: unknown): error is GitHubApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "status" in error &&
    typeof (error as GitHubApiError).message === "string" &&
    typeof (error as GitHubApiError).status === "number"
  )
}

// =============================================================================
// High-level API Methods
// =============================================================================

/**
 * Get the authenticated user's info
 */
export async function getUser(token: string): Promise<GitHubUser> {
  return githubFetch<GitHubUser>("/user", token)
}

/**
 * Get the authenticated user's repositories
 */
export async function getUserRepos(
  token: string,
  options: { sort?: string; perPage?: number; affiliation?: string } = {}
): Promise<GitHubRepo[]> {
  const {
    sort = "updated",
    perPage = 50,
    affiliation = "owner,collaborator,organization_member",
  } = options
  return githubFetch<GitHubRepo[]>(
    `/user/repos?sort=${sort}&per_page=${perPage}&affiliation=${affiliation}`,
    token
  )
}

/**
 * Get a specific repository
 */
export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`, token)
}

/**
 * Get branches for a repository
 */
export async function getRepoBranches(
  token: string,
  owner: string,
  repo: string,
  options: { perPage?: number; paginate?: boolean } = {}
): Promise<GitHubBranch[]> {
  const { perPage = 100, paginate = true } = options

  if (!paginate) {
    return githubFetch<GitHubBranch[]>(
      `/repos/${owner}/${repo}/branches?per_page=${perPage}`,
      token
    )
  }

  // Handle pagination
  const branches: GitHubBranch[] = []
  let page = 1

  while (true) {
    const data = await githubFetch<GitHubBranch[]>(
      `/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`,
      token
    )

    if (!Array.isArray(data) || data.length === 0) break

    branches.push(...data)

    if (data.length < perPage) break
    page++
  }

  return branches
}

/**
 * Compare two branches
 */
export async function compareBranches(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<GitHubCompareResult> {
  return githubFetch<GitHubCompareResult>(
    `/repos/${owner}/${repo}/compare/${base}...${head}`,
    token
  )
}

/**
 * Create a new repository
 */
export async function createRepo(
  token: string,
  options: { name: string; description?: string; isPrivate?: boolean }
): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>("/user/repos", token, {
    method: "POST",
    body: JSON.stringify({
      name: options.name,
      description: options.description,
      private: options.isPrivate ?? false,
    }),
  })
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  options: { title: string; body: string; head: string; base: string }
): Promise<GitHubPullRequest> {
  return githubFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, token, {
    method: "POST",
    body: JSON.stringify(options),
  })
}
