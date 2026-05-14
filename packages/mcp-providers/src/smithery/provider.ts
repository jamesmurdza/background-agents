/**
 * Smithery Connect provider — connection lifecycle helpers.
 *
 * We use Smithery Connect (not the legacy SSE registry) so the per-connection
 * MCP endpoint lives at `api.smithery.ai/connect/<ns>/<connId>/mcp`. The agent
 * speaks MCP to that URL with `Authorization: Bearer <SMITHERY_API_KEY>` —
 * Smithery handles transport + per-server OAuth.
 *
 * Two flows from `createConnection`:
 *   - `connected`     authless server, ready to use immediately
 *   - `auth_required` open `authorizationUrl` in a popup, then verify
 *                     connection status after it closes
 *
 * Namespace resolution is best-effort: explicit namespace if provided, else the
 * first namespace the API key owns, else create `upstream-<keyHash>`
 * (namespace names are globally unique, so we suffix to avoid collisions).
 */

import { createHash } from "crypto"
import type {
  IConnectionProvider,
  ConnectionResult,
  ConnectionStatus,
} from "../types"
import { SMITHERY_API_BASE } from "./constants"

/**
 * Configuration for creating a Smithery provider.
 */
export interface SmitheryConfig {
  /** Smithery API key. */
  apiKey: string
  /** Optional explicit namespace. If not provided, will be auto-resolved. */
  namespace?: string
}

/**
 * Create a Smithery MCP provider instance.
 */
export function createSmitheryProvider(
  config: SmitheryConfig
): SmitheryProvider {
  return new SmitheryProvider(config)
}

/**
 * Deterministic connection id per (chat, qualifiedName) — safe to recreate.
 * Standalone function that doesn't require a provider instance.
 */
export function getSmitheryConnectionId(
  chatId: string,
  qualifiedName: string
): string {
  // Slashes in qualifiedName (e.g. "exa/exa-search") would be parsed as path
  // segments by Smithery, so flatten them.
  const safeName = qualifiedName.replace(/\//g, "-")
  return `chat-${chatId}-${safeName}`
}

export class SmitheryProvider implements IConnectionProvider {
  readonly qualifiedName = "smithery"
  readonly displayName = "Smithery"
  readonly mcpUrl = SMITHERY_API_BASE

  private readonly config: SmitheryConfig
  private resolvedNamespace: string | null = null

  constructor(config: SmitheryConfig) {
    this.config = config
  }

  /**
   * Get or resolve the Smithery namespace for this API key.
   * Cached after first resolution.
   */
  async getNamespace(): Promise<string | null> {
    if (this.resolvedNamespace) return this.resolvedNamespace

    // Try explicit namespace from config
    if (this.config.namespace) {
      const ok = await this.ensureNamespace(this.config.namespace)
      if (ok) {
        this.resolvedNamespace = this.config.namespace
        return this.resolvedNamespace
      }
      return null
    }

    // Try to find an existing namespace owned by this API key
    try {
      const response = await fetch(`${SMITHERY_API_BASE}/namespaces`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      })
      if (response.ok) {
        const data = await response.json()
        const namespaces = data.data || data.namespaces || data
        if (Array.isArray(namespaces) && namespaces.length > 0) {
          this.resolvedNamespace = namespaces[0].name
          console.log(
            "[Smithery Connect] Using existing namespace:",
            this.resolvedNamespace
          )
          return this.resolvedNamespace
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

    // Create a new namespace with a stable hash suffix
    const keyHash = createHash("sha256")
      .update(this.config.apiKey)
      .digest("hex")
      .slice(0, 8)
    const newName = `upstream-${keyHash}`
    console.log("[Smithery Connect] Creating namespace:", newName)
    const ok = await this.ensureNamespace(newName)
    if (ok) {
      this.resolvedNamespace = newName
      return this.resolvedNamespace
    }

    return null
  }

  /**
   * Get the MCP endpoint URL using an explicit namespace.
   */
  getMcpEndpointWithNamespace(
    namespace: string,
    connectionId: string
  ): string {
    return `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}/mcp`
  }

  /**
   * Create or refresh a Smithery Connect connection for `mcpUrl`.
   * Idempotent — calling twice with the same connectionId updates in place.
   */
  async createConnection(
    mcpUrl: string,
    connectionId: string,
    name: string
  ): Promise<ConnectionResult> {
    try {
      const namespace = await this.getNamespace()
      if (!namespace) {
        return {
          status: "error",
          connectionId,
          namespace: "",
          mcpEndpoint: "",
          error: "Failed to resolve Smithery namespace",
        }
      }

      const mcpEndpoint = this.getMcpEndpointWithNamespace(
        namespace,
        connectionId
      )

      const response = await fetch(
        `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
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
   * Check the status of an existing connection.
   */
  async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const namespace = await this.getNamespace()
      if (!namespace) {
        return { state: "error", error: "Failed to resolve namespace" }
      }

      const response = await fetch(
        `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
        { headers: { Authorization: `Bearer ${this.config.apiKey}` } }
      )

      if (!response.ok) {
        console.error(
          "[Smithery Connect] Status check failed:",
          response.status
        )
        return { state: "error", error: `API returned ${response.status}` }
      }

      const data = await response.json()
      const state = data.status?.state || data.status

      if (state === "connected") {
        return { state: "connected" }
      }
      if (state === "auth_required") {
        return { state: "auth_required" }
      }
      if (state === "error") {
        return {
          state: "error",
          error: data.status?.message || "Connection error",
        }
      }

      return { state: "pending" }
    } catch (err) {
      console.error("[Smithery Connect] Status check error:", err)
      return {
        state: "error",
        error: err instanceof Error ? err.message : "Status check failed",
      }
    }
  }

  /**
   * Delete the Smithery connection (best-effort) when a row is removed.
   */
  async deleteConnection(connectionId: string): Promise<void> {
    try {
      const namespace = await this.getNamespace()
      if (!namespace) return
      await fetch(
        `${SMITHERY_API_BASE}/connect/${namespace}/${connectionId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
        }
      )
    } catch (err) {
      // Connection delete is best-effort — DB row deletion is what matters.
      console.warn("[Smithery Connect] DELETE failed (non-fatal):", err)
    }
  }

  /**
   * Ensure a namespace exists, creating it if necessary.
   */
  private async ensureNamespace(name: string): Promise<boolean> {
    try {
      const response = await fetch(`${SMITHERY_API_BASE}/namespaces/${name}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
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
}
