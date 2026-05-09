/**
 * Smithery client + helpers
 *
 * We use Smithery purely as an MCP transport — the auth is *ours*. We point
 * each per-user connection at GitHub's hosted MCP endpoint
 * (api.githubcopilot.com/mcp) and inject a `Authorization: Bearer …` header
 * carrying a short-lived installation token minted from our own GitHub App.
 *
 * Smithery's stored connection headers are updated whenever we rotate the
 * installation token (~hourly). The agent in the sandbox never sees the
 * token: it speaks JSON-RPC to our proxy, which forwards to Smithery, which
 * forwards to GitHub with the header attached.
 */

import Smithery from "@smithery/api"
import { GITHUB_MCP_URL } from "@/lib/github/app"

/**
 * Namespace used for all connections this app creates in Smithery.
 * Must already exist on the Smithery account that owns SMITHERY_API_KEY —
 * create one via `smithery namespace create <name>` or in the dashboard.
 * Override via SMITHERY_NAMESPACE env var; defaults to "simple-chat".
 */
export const SMITHERY_NAMESPACE =
  process.env.SMITHERY_NAMESPACE || "simple-chat"

/** Stable connectionId for a user's GitHub MCP connection. */
export function githubConnectionIdFor(userId: string): string {
  return `user-${userId}-github`
}

let _client: Smithery | null = null

/** Lazily-built singleton. Throws if SMITHERY_API_KEY is unset. */
export function getSmithery(): Smithery {
  if (_client) return _client
  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) {
    throw new Error("SMITHERY_API_KEY is not set")
  }
  _client = new Smithery({ apiKey })
  return _client
}

/**
 * Upsert this user's GitHub MCP connection in Smithery, pointing at GitHub's
 * MCP endpoint with our installation token in the Authorization header.
 *
 * - `initial: true` is for the install callback: we delete any pre-existing
 *   connection (it might have been created against Smithery's old hosted
 *   GitHub OAuth URL, which would 409 if we tried to change mcpUrl) and then
 *   create a fresh one pointing at GITHUB_MCP_URL.
 * - `initial: false` (or omitted) is for token rotation: we only update
 *   headers, leaving mcpUrl untouched.
 */
export async function setGithubConnectionAuth(params: {
  userId: string
  installationToken: string
  initial?: boolean
}): Promise<{ connectionId: string }> {
  const smithery = getSmithery()
  const connectionId = githubConnectionIdFor(params.userId)

  if (params.initial) {
    try {
      await smithery.connections.delete(connectionId, {
        namespace: SMITHERY_NAMESPACE,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // 404 = nothing to delete, fine. Anything else, surface.
      if (!/404|not found/i.test(msg)) {
        throw error
      }
    }
  }

  await smithery.connections.set(connectionId, {
    namespace: SMITHERY_NAMESPACE,
    ...(params.initial ? { mcpUrl: GITHUB_MCP_URL, name: "GitHub" } : {}),
    headers: {
      Authorization: `Bearer ${params.installationToken}`,
    },
    metadata: { userId: params.userId },
  })

  return { connectionId }
}
