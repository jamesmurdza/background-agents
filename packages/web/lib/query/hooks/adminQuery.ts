"use client"

/**
 * Fetch an admin API endpoint and parse the JSON response.
 *
 * Centralizes the error handling shared by every admin query hook:
 * a 403 surfaces as a "Forbidden" error (which {@link adminRetry} refuses to
 * retry), and any other non-OK status throws a generic failure message.
 */
export async function fetchAdminJson<T>(url: string, resourceName: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Forbidden: Admin access required")
    }
    throw new Error(`Failed to fetch admin ${resourceName}`)
  }
  return response.json()
}

/**
 * Shared react-query `retry` predicate for admin queries: never retry a
 * Forbidden (403) response, otherwise retry up to three times.
 */
export function adminRetry(failureCount: number, error: Error): boolean {
  if (error.message.includes("Forbidden")) {
    return false
  }
  return failureCount < 3
}
