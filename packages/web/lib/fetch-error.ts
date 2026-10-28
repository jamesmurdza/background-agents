/**
 * Shared helper for extracting a human-readable message from a failed
 * `fetch` response's JSON body.
 */

/**
 * Extract an error message from a failed response's JSON body, checking the
 * `error` field first and then `message` (different proxy routes use either
 * convention — see `/api/git/*` vs the GitHub API's own error shape), and
 * falling back to `fallback` when the body is missing, not JSON, or neither
 * field is a non-empty string.
 */
export async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown }
  if (typeof data.error === "string" && data.error) return data.error
  if (typeof data.message === "string" && data.message) return data.message
  return fallback
}
