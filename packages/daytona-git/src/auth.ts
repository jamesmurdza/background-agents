/**
 * Authentication utilities for git operations
 *
 * Credentials are injected into URLs temporarily and never persisted.
 */

/**
 * Create an authenticated git URL
 *
 * @param url - Original URL (https://github.com/owner/repo.git)
 * @param username - Git username (e.g., "x-access-token" for GitHub)
 * @param password - Git password or token
 * @returns URL with embedded credentials
 *
 * @example
 * createAuthUrl("https://github.com/owner/repo.git", "x-access-token", "ghp_xxx")
 * // => "https://x-access-token:ghp_xxx@github.com/owner/repo.git"
 */
export function createAuthUrl(
  url: string,
  username: string,
  password: string
): string {
  // Handle URLs that already have credentials
  const cleanUrl = stripCredentials(url)
  return cleanUrl.replace("https://", `https://${username}:${password}@`)
}

/**
 * Strip any existing credentials from a URL
 *
 * @param url - URL that may contain credentials
 * @returns URL without credentials
 *
 * @example
 * stripCredentials("https://user:pass@github.com/owner/repo.git")
 * // => "https://github.com/owner/repo.git"
 */
export function stripCredentials(url: string): string {
  return url.replace(/https:\/\/[^@]+@/, "https://")
}

/**
 * Check if a URL contains credentials
 */
export function hasCredentials(url: string): boolean {
  return /https:\/\/[^/]+@/.test(url)
}
