/**
 * GitHub API client helper
 * Provides a consistent interface for making GitHub API requests
 */

export interface GitHubApiError {
  message: string
  status: number
}

export interface GitHubFetchOptions extends Omit<RequestInit, "headers"> {
  /** Custom Accept header (defaults to application/vnd.github.v3+json) */
  accept?: string
}

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
 * Makes a request to the GitHub API that returns text (e.g., diffs)
 */
export async function githubFetchText(
  url: string,
  token: string,
  options: GitHubFetchOptions = {}
): Promise<string> {
  const { accept = "application/vnd.github.v3+json", ...fetchOptions } = options

  const fullUrl = url.startsWith("http") ? url : `https://api.github.com${url}`

  const response = await fetch(fullUrl, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw { message: `GitHub API error: ${response.status} ${text}`, status: response.status } as GitHubApiError
  }

  return response.text()
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
// Common GitHub API Types
// =============================================================================

export interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
}

export interface GitHubRepo {
  name: string
  full_name: string
  owner: { login: string; avatar_url: string }
  default_branch: string
  private: boolean
  description: string | null
  permissions?: { push: boolean; pull: boolean; admin: boolean }
}

export interface GitHubBranch {
  name: string
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
// High-level API methods
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
  const { sort = "updated", perPage = 50, affiliation = "owner,collaborator" } = options
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
 * Get all branches for a repository (handles pagination)
 */
export async function getRepoBranches(token: string, owner: string, repo: string): Promise<string[]> {
  const branches: string[] = []
  let page = 1

  while (true) {
    const data = await githubFetch<GitHubBranch[]>(
      `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
      token
    )

    if (!Array.isArray(data) || data.length === 0) break

    for (const branch of data) {
      branches.push(branch.name)
    }

    if (data.length < 100) break
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
 * Get diff between commits or branches
 */
export async function getDiff(
  token: string,
  owner: string,
  repo: string,
  options: { commitHash?: string; base?: string; head?: string }
): Promise<string> {
  const { commitHash, base, head } = options

  let url: string
  if (commitHash) {
    url = `/repos/${owner}/${repo}/commits/${commitHash}`
  } else if (base && head) {
    url = `/repos/${owner}/${repo}/compare/${base}...${head}`
  } else {
    throw new Error("Must provide commitHash or base+head")
  }

  return githubFetchText(url, token, { accept: "application/vnd.github.v3.diff" })
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
      auto_init: true,
    }),
  })
}

/**
 * Fork a repository
 */
export async function forkRepo(token: string, owner: string, name: string): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(`/repos/${owner}/${name}/forks`, token, {
    method: "POST",
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
