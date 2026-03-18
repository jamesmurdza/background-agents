import { NextResponse } from "next/server"

// MCP Registry API types
interface RegistryServerMeta {
  slug?: string
  displayName?: string
  oneLiner?: string
  iconUrl?: string
  documentation?: string
  toolNames?: string[]
  isAuthless?: boolean
  worksWith?: string[]
  useCases?: string[]
  popularityScore?: number
}

interface RegistryServer {
  server: {
    name: string
    title?: string
    description?: string
    version?: string
    remotes?: Array<{
      type: string
      url: string
    }>
  }
  _meta?: {
    "com.anthropic.api/mcp-registry"?: RegistryServerMeta
  }
}

interface RegistryResponse {
  servers: RegistryServer[]
  metadata?: {
    count?: number
    nextCursor?: string
  }
}

// Transform registry server to simplified format
function transformServer(server: RegistryServer) {
  const meta = server._meta?.["com.anthropic.api/mcp-registry"]
  const remote = server.server.remotes?.[0]

  return {
    slug: meta?.slug || server.server.name.split("/").pop() || server.server.name,
    name: server.server.title || meta?.displayName || server.server.name,
    description: meta?.oneLiner || server.server.description || "",
    iconUrl: meta?.iconUrl || null,
    url: remote?.url || null,
    transportType: remote?.type === "streamable-http" ? "http" : remote?.type || "http",
    documentation: meta?.documentation || null,
    tools: meta?.toolNames || [],
    toolCount: meta?.toolNames?.length || 0,
    requiresAuth: !meta?.isAuthless,
    useCases: meta?.useCases || [],
    popularityScore: meta?.popularityScore || 0,
    worksWith: meta?.worksWith || [],
  }
}

// GET - Proxy to Anthropic MCP registry
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const search = searchParams.get("search") || ""
  const cursor = searchParams.get("cursor") || ""
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50)

  try {
    // Build registry URL
    const registryUrl = new URL("https://api.anthropic.com/mcp-registry/v0/servers")
    registryUrl.searchParams.set("visibility", "commercial")
    registryUrl.searchParams.set("limit", String(limit))

    if (search) {
      registryUrl.searchParams.set("search", search)
    }
    if (cursor) {
      registryUrl.searchParams.set("cursor", cursor)
    }

    // Fetch from registry
    const response = await fetch(registryUrl.toString(), {
      headers: {
        "Accept": "application/json",
      },
      // Cache for 5 minutes
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      console.error("Registry fetch failed:", response.status, await response.text())
      return NextResponse.json(
        { error: "Failed to fetch registry" },
        { status: 502 }
      )
    }

    const data: RegistryResponse = await response.json()

    // Filter for Claude Code compatible servers and transform
    const servers = data.servers
      .filter((s) => {
        const worksWith = s._meta?.["com.anthropic.api/mcp-registry"]?.worksWith || []
        // Include servers that work with claude-code, or don't specify (assume compatible)
        return worksWith.length === 0 || worksWith.includes("claude-code")
      })
      .filter((s) => {
        // Must have a remote URL
        return s.server.remotes && s.server.remotes.length > 0
      })
      .map(transformServer)
      // Sort by popularity
      .sort((a, b) => b.popularityScore - a.popularityScore)

    return NextResponse.json({
      servers,
      nextCursor: data.metadata?.nextCursor || null,
      total: data.metadata?.count || servers.length,
    })
  } catch (err) {
    console.error("Registry proxy error:", err)
    return NextResponse.json(
      { error: "Failed to fetch registry" },
      { status: 500 }
    )
  }
}
