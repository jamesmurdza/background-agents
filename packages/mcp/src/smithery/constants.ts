/**
 * Smithery MCP constants.
 */

/** Base URL for Smithery API. */
export const SMITHERY_API_BASE = "https://api.smithery.ai"

/** Smithery-hosted server URLs all live under server.smithery.ai. */
export function isSmitheryServer(url: string): boolean {
  try {
    return new URL(url).hostname === "server.smithery.ai"
  } catch {
    return false
  }
}
