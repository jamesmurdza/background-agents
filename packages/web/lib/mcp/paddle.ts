/**
 * Shared Paddle MCP provider for the web app: builds consent URLs, signs/
 * verifies OAuth state, and refreshes Paddle access tokens. Returns null
 * when the Paddle OAuth env vars aren't configured.
 */
import { createPaddleMcpProvider, type PaddleMcpProvider } from "@background-agents/mcp"
import { appBaseUrl } from "@/lib/server/app-url"

let paddleProvider: PaddleMcpProvider | null = null

/** For serverConfigError when getPaddleProvider() returns null. */
export const PADDLE_CONFIG_VARS = "PADDLE_CLIENT_ID/PADDLE_MCP_JWT_SECRET"

export function getPaddleProvider(): PaddleMcpProvider | null {
  if (paddleProvider) return paddleProvider

  const clientId = process.env.PADDLE_CLIENT_ID
  const jwtSecret = process.env.PADDLE_MCP_JWT_SECRET

  if (!clientId || !jwtSecret) {
    return null
  }

  paddleProvider = createPaddleMcpProvider({ clientId, jwtSecret })
  return paddleProvider
}

/** Must match a redirect URI registered on the Paddle OAuth client. */
export function getPaddleRedirectUri(): string {
  return `${appBaseUrl()}/api/mcp/connect/paddle/callback`
}
