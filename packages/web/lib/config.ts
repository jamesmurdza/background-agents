/**
 * Application configuration constants
 */

export const APP_NAME = "Background Agents"
export const APP_DESCRIPTION = "An AI coding agent chat interface"

/**
 * Generate a page title with consistent formatting
 * @param parts - Title parts to join (e.g., ["Chat Name", "Scheduled Jobs"])
 * @returns Formatted title like "Chat Name · Background Agents"
 */
export function formatPageTitle(...parts: (string | null | undefined)[]): string {
  const filtered = parts.filter(Boolean) as string[]
  if (filtered.length === 0) {
    return APP_NAME
  }
  return `${filtered.join(" · ")} · ${APP_NAME}`
}
