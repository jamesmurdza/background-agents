/**
 * Authentication utilities for git operations
 *
 * Credentials are passed via git -c flags and never persisted.
 */

// Declare globals for environments (Node.js Buffer, browser btoa)
declare const Buffer: { from(str: string): { toString(encoding: string): string } } | undefined
declare const btoa: ((str: string) => string) | undefined

/**
 * Base64 encode a string (works in both Node.js and browsers)
 */
function base64Encode(str: string): string {
  // Node.js
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64")
  }
  // Browser
  if (typeof btoa !== "undefined") {
    return btoa(str)
  }
  throw new Error("No base64 encoding available")
}

/**
 * Create an authenticated git URL (used only for clone operations)
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
 * Build git -c flags for authentication
 *
 * Uses http.extraHeader with Basic auth to pass credentials without touching any config.
 * The credential exists only for the single command invocation.
 *
 * GitHub's git protocol expects Basic auth with "x-access-token" as username
 * and the PAT as password, base64 encoded.
 *
 * @param token - The authentication token (e.g., GitHub PAT)
 * @param username - Git username (default: "x-access-token" for GitHub)
 * @returns Git -c flag string to prepend to commands
 *
 * @example
 * buildAuthFlags("ghp_xxx")
 * // => "-c http.extraHeader='Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hwX3h4eA=='"
 */
export function buildAuthFlags(token: string, username = "x-access-token"): string {
  // GitHub expects Basic auth: base64(username:password)
  const credentials = base64Encode(`${username}:${token}`)
  // Escape single quotes in the header value (unlikely but safe)
  const escaped = credentials.replace(/'/g, "'\\''")
  return `-c http.extraHeader='Authorization: Basic ${escaped}'`
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
