/**
 * Authentication utilities for git operations
 *
 * Token is passed via git -c flag and never persisted.
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

function esc(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Build git command with auth header
 */
export function withAuth(token: string, gitCmd: string): string {
  const creds = base64Encode(`x-access-token:${token}`)
  return `git -c http.extraHeader=${esc(`Authorization: Basic ${creds}`)} ${gitCmd}`
}
