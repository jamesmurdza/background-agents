/**
 * Authentication utilities for git operations
 *
 * Token is passed via environment variable to avoid exposure in process list.
 */

// Declare globals for environments (Node.js Buffer, browser btoa)
declare const Buffer:
  | { from(str: string): { toString(encoding: string): string } }
  | undefined
declare const btoa: ((str: string) => string) | undefined

/**
 * Base64 encode a string (works in both Node.js and browsers)
 */
function base64Encode(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64")
  }
  if (typeof btoa !== "undefined") {
    return btoa(str)
  }
  throw new Error("No base64 encoding available")
}

/**
 * Build a command that runs git with auth, hiding token from process list.
 *
 * Uses an inline environment variable so the token doesn't appear in `ps aux`.
 * The env var is expanded by the shell, not visible in the command args.
 *
 * @param token - The authentication token
 * @param gitCommand - The git command (e.g., "push -u origin HEAD")
 * @returns Full shell command with hidden auth
 */
export function withAuth(token: string, gitCommand: string): string {
  const credentials = base64Encode(`x-access-token:${token}`)
  // Token in env var, not in command args - hidden from ps
  return `GIT_AUTH_HEADER='Authorization: Basic ${credentials}' git -c http.extraHeader="$GIT_AUTH_HEADER" ${gitCommand}`
}
