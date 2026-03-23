import { encrypt } from "@/lib/encryption"
import { prisma } from "@/lib/prisma"

const SMITHERY_API_BASE = "https://api.smithery.ai"
const SMITHERY_NAMESPACE = "upstream-agents"

/**
 * Check if a URL points to a Smithery-hosted MCP server
 */
export function isSmitheryServer(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === "server.smithery.ai"
  } catch {
    return false
  }
}

/**
 * Generate a deterministic connection ID for a repo + server combo
 */
export function getSmitheryConnectionId(repoId: string, slug: string): string {
  return `${repoId}-${slug.replace(/\//g, "-")}`
}

/**
 * Get the Smithery Connect MCP endpoint URL for a connection
 */
export function getSmitheryMcpEndpoint(connectionId: string): string {
  return `${SMITHERY_API_BASE}/connect/${SMITHERY_NAMESPACE}/${connectionId}/mcp`
}

/**
 * Ensure the Smithery namespace exists (idempotent PUT)
 */
async function ensureNamespace(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${SMITHERY_API_BASE}/namespaces/${SMITHERY_NAMESPACE}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }
    )

    if (!response.ok && response.status !== 409) {
      console.error("[Smithery Connect] Failed to create namespace:", response.status)
      return false
    }

    return true
  } catch (err) {
    console.error("[Smithery Connect] Namespace creation error:", err)
    return false
  }
}

interface SmitheryConnectionResult {
  status: "connected" | "auth_required" | "error"
  authorizationUrl?: string
  connectionId: string
  mcpEndpoint: string
  error?: string
}

/**
 * Create or retrieve a Smithery Connect connection.
 *
 * Smithery Connect manages OAuth and credentials for hosted MCP servers.
 * - If the server requires no auth, returns status "connected" immediately.
 * - If OAuth is required, returns status "auth_required" with authorizationUrl.
 * - After user completes OAuth, calling again returns "connected".
 */
export async function createSmitheryConnection(
  mcpUrl: string,
  connectionId: string,
  name: string,
  apiKey: string
): Promise<SmitheryConnectionResult> {
  const mcpEndpoint = getSmitheryMcpEndpoint(connectionId)

  try {
    // Ensure namespace exists first (idempotent)
    const nsOk = await ensureNamespace(apiKey)
    if (!nsOk) {
      return {
        status: "error",
        connectionId,
        mcpEndpoint,
        error: "Failed to create Smithery namespace",
      }
    }

    // Create or update connection via PUT
    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${SMITHERY_NAMESPACE}/${connectionId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          mcpUrl,
          name,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[Smithery Connect] API error:", response.status, errorText)
      return {
        status: "error",
        connectionId,
        mcpEndpoint,
        error: `Smithery API returned ${response.status}`,
      }
    }

    const data = await response.json()
    const state = data.status?.state || data.status

    if (state === "auth_required") {
      return {
        status: "auth_required",
        authorizationUrl: data.status?.authorizationUrl,
        connectionId: data.connectionId || connectionId,
        mcpEndpoint,
      }
    }

    if (state === "connected") {
      return {
        status: "connected",
        connectionId: data.connectionId || connectionId,
        mcpEndpoint,
      }
    }

    if (state === "error") {
      return {
        status: "error",
        connectionId,
        mcpEndpoint,
        error: data.status?.message || "Smithery connection error",
      }
    }

    // Unknown status
    return {
      status: "error",
      connectionId,
      mcpEndpoint,
      error: `Unexpected status: ${JSON.stringify(data.status)}`,
    }
  } catch (err) {
    console.error("[Smithery Connect] Connection error:", err)
    return {
      status: "error",
      connectionId,
      mcpEndpoint,
      error: err instanceof Error ? err.message : "Connection failed",
    }
  }
}

/**
 * Finalize a Smithery connection after OAuth callback.
 * Checks connection status and updates the DB record.
 */
export async function finalizeSmitheryConnection(
  serverId: string,
  connectionId: string,
  apiKey: string
): Promise<boolean> {
  const mcpEndpoint = getSmitheryMcpEndpoint(connectionId)

  try {
    // Check connection status via GET
    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${SMITHERY_NAMESPACE}/${connectionId}`,
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }
    )

    if (!response.ok) {
      console.error("[Smithery Connect] Status check failed:", response.status)
      return false
    }

    const data = await response.json()
    const state = data.status?.state || data.status

    if (state === "connected") {
      await prisma.repoMcpServer.update({
        where: { id: serverId },
        data: {
          url: mcpEndpoint,
          accessToken: encrypt(apiKey),
          status: "connected",
          lastError: null,
        },
      })
      return true
    }

    return false
  } catch (err) {
    console.error("[Smithery Connect] Finalize error:", err)
    return false
  }
}
