/**
 * Shared Gmail MCP provider for the web app: signs/verifies the connection
 * tokens agents use and refreshes Google access tokens. Returns null when the
 * Google OAuth env vars aren't configured.
 */
import { createGmailMcpProvider, type GmailMcpProvider } from "@background-agents/mcp"
import { appBaseUrl } from "@/lib/server/app-url"

let gmailProvider: GmailMcpProvider | null = null

/** For serverConfigError when getGmailProvider() returns null. */
export const GMAIL_CONFIG_VARS = "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GMAIL_MCP_JWT_SECRET"

export function getGmailProvider(): GmailMcpProvider | null {
  if (gmailProvider) return gmailProvider

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const jwtSecret = process.env.GMAIL_MCP_JWT_SECRET

  if (!clientId || !clientSecret || !jwtSecret) {
    return null
  }

  gmailProvider = createGmailMcpProvider({ clientId, clientSecret, jwtSecret })
  return gmailProvider
}

/** Must match an authorized redirect URI on the Google OAuth client. */
export function getGmailRedirectUri(): string {
  return `${appBaseUrl()}/api/mcp/connect/gmail/callback`
}

/**
 * Where agents reach our Gmail MCP server. Agents run in remote sandboxes that
 * can't reach localhost, so local dev sets GMAIL_MCP_BASE_URL to a tunnel.
 */
export function getGmailMcpUrl(): string {
  const base = process.env.GMAIL_MCP_BASE_URL?.replace(/\/$/, "") ?? appBaseUrl()
  return `${base}/api/mcp/gmail`
}
