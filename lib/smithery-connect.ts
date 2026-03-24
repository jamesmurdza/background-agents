import { encrypt } from "@/lib/encryption"
import { prisma } from "@/lib/prisma"
import { createHash } from "crypto"

const SMITHERY_API_BASE = "https://api.smithery.ai"

// Each Smithery API key owns its own namespaces.
// Use SMITHERY_NAMESPACE env var if set, otherwise auto-create one.
let resolvedNamespace: string | null = null

async function getNamespace(apiKey: string): Promise<string | null> {
  // Return cached namespace
  if (resolvedNamespace) return resolvedNamespace

  // Use explicit env var if set
  const envNamespace = process.env.SMITHERY_NAMESPACE
  if (envNamespace) {
    const ok = await ensureNamespace(envNamespace, apiKey)
    if (ok) {
      resolvedNamespace = envNamespace
      return resolvedNamespace
    }
    return null
  }

  // Auto-detect: fetch user's existing namespaces or create one
  try {
    const response = await fetch(`${SMITHERY_API_BASE}/namespaces`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    })
    if (response.ok) {
      const data = await response.json()
      const namespaces = data.data || data.namespaces || data
      if (Array.isArray(namespaces) && namespaces.length > 0) {
        resolvedNamespace = namespaces[0].name
        console.log("[Smithery Connect] Using existing namespace:", resolvedNamespace)
        return resolvedNamespace
      }
    } else {
      const body = await response.text()
      console.error("[Smithery Connect] Failed to list namespaces:", response.status, body)
    }
  } catch (err) {
    console.error("[Smithery Connect] Failed to list namespaces:", err)
  }

  // No namespaces exist — create a unique one per API key
  const keyHash = createHash("sha256").update(apiKey).digest("hex").slice(0, 8)
  const newName = `upstream-${keyHash}`
  console.log("[Smithery Connect] Creating namespace:", newName)
  const ok = await ensureNamespace(newName, apiKey)
  if (ok) {
    resolvedNamespace = newName
    return resolvedNamespace
  }

  return null
}

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
export function getSmitheryMcpEndpoint(namespace: string, connectionId: string): string {
  return `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}/mcp`
}

/**
 * Ensure the Smithery namespace exists (idempotent PUT)
 */
async function ensureNamespace(name: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${SMITHERY_API_BASE}/namespaces/${name}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      }
    )

    if (!response.ok) {
      const body = await response.text()
      // 409 means namespace already exists — only OK if we own it
      if (response.status === 409 && !body.includes("another user")) {
        return true
      }
      console.error("[Smithery Connect] Failed to create namespace:", response.status, body)
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
  try {
    // Resolve namespace for this API key
    const namespace = await getNamespace(apiKey)
    if (!namespace) {
      return {
        status: "error",
        connectionId,
        mcpEndpoint: "",
        error: "Failed to resolve Smithery namespace",
      }
    }

    const mcpEndpoint = getSmitheryMcpEndpoint(namespace, connectionId)

    // Create or update connection via PUT
    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
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
      mcpEndpoint: "",
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
  try {
    const namespace = await getNamespace(apiKey)
    if (!namespace) return false

    const mcpEndpoint = getSmitheryMcpEndpoint(namespace, connectionId)

    // Check connection status via GET
    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
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
