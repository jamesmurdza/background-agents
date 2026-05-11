/**
 * GET /api/mcp-registry/<namespace>/<name>
 *
 * Per-server detail. Used when the user clicks Connect on a non-deployed
 * server (no URL came back in the registry list) — we need to fetch the
 * connection URL before kicking off Smithery Connect.
 */
import { NextResponse } from "next/server"
import { serverConfigError } from "@/lib/db/api-helpers"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
): Promise<Response> {
  const { slug } = await params
  const qualifiedName = slug.join("/")

  if (slug.length < 2) {
    return NextResponse.json(
      { error: "Invalid server identifier. Expected format: namespace/name" },
      { status: 400 }
    )
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) return serverConfigError("SMITHERY_API_KEY")

  try {
    const response = await fetch(
      `https://api.smithery.ai/servers/${encodeURIComponent(qualifiedName)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        next: { revalidate: 300 },
      }
    )

    if (response.status === 404) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 })
    }
    if (!response.ok) {
      console.error(
        "[MCP-registry/detail] Smithery fetch failed:",
        response.status
      )
      return NextResponse.json(
        { error: "Failed to fetch server details" },
        { status: 502 }
      )
    }

    const data = await response.json()
    return NextResponse.json({
      slug: qualifiedName,
      name: data.displayName || qualifiedName,
      description: data.description || "",
      iconUrl: data.iconUrl || null,
      url: data.connectionUrl || data.url || null,
      tools: data.tools || [],
      verified: data.verified || false,
      useCount: data.useCount || 0,
    })
  } catch (err) {
    console.error("[MCP-registry/detail] Error:", err)
    return NextResponse.json(
      { error: "Failed to fetch server details" },
      { status: 500 }
    )
  }
}
