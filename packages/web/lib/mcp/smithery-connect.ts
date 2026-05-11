/**
 * Smithery Connect — connection lifecycle helpers.
 *
 * We use Smithery Connect (not the legacy SSE registry) so the per-connection
 * MCP endpoint lives at `api.smithery.ai/connect/<ns>/<connId>/mcp`. The agent
 * speaks MCP to that URL with `Authorization: Bearer <SMITHERY_API_KEY>` —
 * Smithery handles transport + per-server OAuth.
 *
 * Two flows from `createSmitheryConnection`:
 *   - `connected`     authless server, ready to use immediately
 *   - `auth_required` open `authorizationUrl` in a popup, then call
 *                     `finalizeSmitheryConnection` after it closes
 *
 * Namespace resolution is best-effort: SMITHERY_NAMESPACE if set, else the
 * first namespace the API key owns, else create `upstream-<keyHash>`
 * (namespace names are globally unique, so we suffix to avoid collisions).
 */
import { createHash } from "crypto"
import { encrypt } from "@/lib/db/encryption"
import { prisma } from "@/lib/db/prisma"

const SMITHERY_API_BASE = "https://api.smithery.ai"

// Resolved once per process. Smithery namespace lookups are cheap but pointless
// to repeat — the answer is stable for a given API key.
let resolvedNamespace: string | null = null

async function getNamespace(apiKey: string): Promise<string | null> {
  if (resolvedNamespace) return resolvedNamespace

  const envNamespace = process.env.SMITHERY_NAMESPACE
  if (envNamespace) {
    const ok = await ensureNamespace(envNamespace, apiKey)
    if (ok) {
      resolvedNamespace = envNamespace
      return resolvedNamespace
    }
    return null
  }

  try {
    const response = await fetch(`${SMITHERY_API_BASE}/namespaces`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (response.ok) {
      const data = await response.json()
      const namespaces = data.data || data.namespaces || data
      if (Array.isArray(namespaces) && namespaces.length > 0) {
        resolvedNamespace = namespaces[0].name
        console.log(
          "[Smithery Connect] Using existing namespace:",
          resolvedNamespace
        )
        return resolvedNamespace
      }
    } else {
      const body = await response.text()
      console.error(
        "[Smithery Connect] Failed to list namespaces:",
        response.status,
        body
      )
    }
  } catch (err) {
    console.error("[Smithery Connect] Failed to list namespaces:", err)
  }

  // Globally-unique namespace name: suffix with a stable hash of the API key so
  // two different accounts don't collide on a friendly prefix.
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

/** Smithery-hosted server URLs all live under server.smithery.ai. */
export function isSmitheryServer(url: string): boolean {
  try {
    return new URL(url).hostname === "server.smithery.ai"
  } catch {
    return false
  }
}

/** Deterministic connection id per (chat, qualifiedName) — safe to recreate. */
export function getSmitheryConnectionId(
  chatId: string,
  qualifiedName: string
): string {
  // Slashes in qualifiedName (e.g. "exa/exa-search") would be parsed as path
  // segments by Smithery, so flatten them.
  const safeName = qualifiedName.replace(/\//g, "-")
  return `chat-${chatId}-${safeName}`
}

/** Per-connection MCP endpoint the agent will call. */
function getSmitheryMcpEndpoint(
  namespace: string,
  connectionId: string
): string {
  return `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}/mcp`
}

async function ensureNamespace(
  name: string,
  apiKey: string
): Promise<boolean> {
  try {
    const response = await fetch(`${SMITHERY_API_BASE}/namespaces/${name}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!response.ok) {
      const body = await response.text()
      // 409 = name taken. Only safe if WE own it; Smithery's error body
      // mentions "another user" when it's someone else's.
      if (response.status === 409 && !body.includes("another user")) {
        return true
      }
      console.error(
        "[Smithery Connect] Failed to create namespace:",
        response.status,
        body
      )
      return false
    }

    return true
  } catch (err) {
    console.error("[Smithery Connect] Namespace creation error:", err)
    return false
  }
}

export interface SmitheryConnectionResult {
  status: "connected" | "auth_required" | "error"
  authorizationUrl?: string
  connectionId: string
  namespace: string
  mcpEndpoint: string
  error?: string
}

/**
 * Create or refresh a Smithery Connect connection for `mcpUrl`.
 * Idempotent — calling twice with the same connectionId updates in place.
 */
export async function createSmitheryConnection(
  mcpUrl: string,
  connectionId: string,
  name: string,
  apiKey: string
): Promise<SmitheryConnectionResult> {
  try {
    const namespace = await getNamespace(apiKey)
    if (!namespace) {
      return {
        status: "error",
        connectionId,
        namespace: "",
        mcpEndpoint: "",
        error: "Failed to resolve Smithery namespace",
      }
    }

    const mcpEndpoint = getSmitheryMcpEndpoint(namespace, connectionId)

    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ mcpUrl, name }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(
        "[Smithery Connect] PUT /connect failed:",
        response.status,
        errorText
      )
      return {
        status: "error",
        connectionId,
        namespace,
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
        namespace,
        mcpEndpoint,
      }
    }

    if (state === "connected") {
      return {
        status: "connected",
        connectionId: data.connectionId || connectionId,
        namespace,
        mcpEndpoint,
      }
    }

    if (state === "error") {
      return {
        status: "error",
        connectionId,
        namespace,
        mcpEndpoint,
        error: data.status?.message || "Smithery connection error",
      }
    }

    return {
      status: "error",
      connectionId,
      namespace,
      mcpEndpoint,
      error: `Unexpected status: ${JSON.stringify(data.status)}`,
    }
  } catch (err) {
    console.error("[Smithery Connect] Connection error:", err)
    return {
      status: "error",
      connectionId,
      namespace: "",
      mcpEndpoint: "",
      error: err instanceof Error ? err.message : "Connection failed",
    }
  }
}

/**
 * After the OAuth popup closes, ping Smithery to verify the connection is now
 * `connected`. On success, persist the endpoint + encrypted API key on the
 * ChatMcpServer row so agent runs can use it.
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

    const response = await fetch(
      `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!response.ok) {
      console.error(
        "[Smithery Connect] Status check failed:",
        response.status
      )
      return false
    }

    const data = await response.json()
    const state = data.status?.state || data.status

    if (state === "connected") {
      await prisma.chatMcpServer.update({
        where: { id: serverId },
        data: {
          mcpUrl: mcpEndpoint,
          smitheryNamespace: namespace,
          encryptedApiKey: encrypt(apiKey),
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

/** Delete the Smithery connection (best-effort) when a row is removed. */
export async function deleteSmitheryConnection(
  connectionId: string,
  apiKey: string
): Promise<void> {
  try {
    const namespace = await getNamespace(apiKey)
    if (!namespace) return
    await fetch(`${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (err) {
    // Connection delete is best-effort — DB row deletion is what matters.
    console.warn("[Smithery Connect] DELETE failed (non-fatal):", err)
  }
}
