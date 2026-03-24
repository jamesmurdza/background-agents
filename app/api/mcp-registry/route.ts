import { NextResponse } from "next/server"

// Smithery Registry API types
interface SmitheryServer {
  id: string
  qualifiedName: string
  displayName: string
  description: string
  iconUrl: string | null
  verified: boolean
  useCount: number
  remote: boolean | null
  isDeployed: boolean
  createdAt: string
  homepage: string | null
  owner: string | null
}

interface SmitheryResponse {
  servers: SmitheryServer[]
  pagination: {
    currentPage: number
    pageSize: number
    totalPages: number
    totalCount: number
  }
}

// Transform Smithery server to our frontend format
function transformServer(server: SmitheryServer) {
  // For deployed servers, construct the MCP URL; others need a detail fetch on connect
  const url = server.isDeployed
    ? `https://server.smithery.ai/${server.qualifiedName}/mcp`
    : null

  return {
    slug: server.qualifiedName,
    name: server.displayName,
    description: server.description || "",
    iconUrl: server.iconUrl,
    url,
    toolCount: 0,
    requiresAuth: true,
    useCases: [] as string[],
    verified: server.verified,
    useCount: server.useCount,
    isDeployed: server.isDeployed,
  }
}

// GET - Proxy to Smithery MCP registry
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const search = searchParams.get("search") || ""
  const page = Math.max(parseInt(searchParams.get("page") || "1"), 1)
  const pageSize = Math.min(Math.max(parseInt(searchParams.get("pageSize") || "20"), 1), 50)

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) {
    console.error("SMITHERY_API_KEY is not configured")
    return NextResponse.json(
      { error: "MCP registry is not configured" },
      { status: 500 }
    )
  }

  try {
    // Build Smithery registry URL
    const registryUrl = new URL("https://api.smithery.ai/servers")
    registryUrl.searchParams.set("page", String(page))
    registryUrl.searchParams.set("pageSize", String(pageSize))
    registryUrl.searchParams.set("remote", "true")

    if (search) {
      registryUrl.searchParams.set("q", search)
    }

    // Fetch from Smithery registry
    const response = await fetch(registryUrl.toString(), {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      // Cache for 5 minutes
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      console.error("Smithery registry fetch failed:", response.status, await response.text())
      return NextResponse.json(
        { error: "Failed to fetch registry" },
        { status: 502 }
      )
    }

    const data: SmitheryResponse = await response.json()

    const servers = data.servers.map(transformServer)

    return NextResponse.json({
      servers,
      page: data.pagination.currentPage,
      pageSize: data.pagination.pageSize,
      totalPages: data.pagination.totalPages,
      totalCount: data.pagination.totalCount,
    })
  } catch (err) {
    console.error("Smithery registry proxy error:", err)
    return NextResponse.json(
      { error: "Failed to fetch registry" },
      { status: 500 }
    )
  }
}
