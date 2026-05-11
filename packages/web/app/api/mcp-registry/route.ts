/**
 * GET /api/mcp-registry
 *
 * Thin proxy over Smithery's server registry. Filters to `remote=true` since
 * the agent runs in a sandbox and can't spawn local stdio servers.
 *
 * Query params:
 *   - search    free-text passed to Smithery as `q`
 *   - page      1-based (default 1)
 *   - pageSize  1..50 (default 20)
 */
import { NextResponse } from "next/server"
import { serverConfigError } from "@/lib/db/api-helpers"

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

function transformServer(server: SmitheryServer) {
  // Deployed servers expose the MCP URL via predictable path; non-deployed
  // need a follow-up detail fetch on connect.
  const url = server.isDeployed
    ? `https://server.smithery.ai/${server.qualifiedName}/mcp`
    : null
  return {
    slug: server.qualifiedName,
    name: server.displayName,
    description: server.description || "",
    iconUrl: server.iconUrl,
    url,
    verified: server.verified,
    useCount: server.useCount,
    isDeployed: server.isDeployed,
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = Math.max(parseInt(searchParams.get("page") || "1"), 1)
  const pageSize = Math.min(
    Math.max(parseInt(searchParams.get("pageSize") || "20"), 1),
    50
  )

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  try {
    const registryUrl = new URL("https://api.smithery.ai/servers")
    registryUrl.searchParams.set("page", String(page))
    registryUrl.searchParams.set("pageSize", String(pageSize))
    registryUrl.searchParams.set("remote", "true")
    if (search) registryUrl.searchParams.set("q", search)

    const response = await fetch(registryUrl.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // 5-min cache: the registry doesn't change often and search latency
      // dominates the modal UX otherwise.
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      console.error(
        "[MCP-registry] Smithery fetch failed:",
        response.status,
        await response.text()
      )
      return NextResponse.json(
        { error: "Failed to fetch registry" },
        { status: 502 }
      )
    }

    const data: SmitheryResponse = await response.json()
    return NextResponse.json({
      servers: data.servers.map(transformServer),
      page: data.pagination.currentPage,
      pageSize: data.pagination.pageSize,
      totalPages: data.pagination.totalPages,
      totalCount: data.pagination.totalCount,
    })
  } catch (err) {
    console.error("[MCP-registry] Proxy error:", err)
    return NextResponse.json(
      { error: "Failed to fetch registry" },
      { status: 500 }
    )
  }
}
