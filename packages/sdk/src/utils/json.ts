/**
 * JSON parsing utilities
 */

/**
 * Safely parse JSON, returning null on failure
 */
export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
