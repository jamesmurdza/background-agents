import { NextResponse } from "next/server"

// GET - Fetch server details from Smithery by qualifiedName
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params

  // Reconstruct qualifiedName from slug segments (e.g. ["namespace", "name"] → "namespace/name")
  const qualifiedName = slug.join("/")

  if (slug.length < 2) {
    return NextResponse.json(
      { error: "Invalid server identifier. Expected format: namespace/name" },
      { status: 400 }
    )
  }

  const apiKey = process.env.SMITHERY_API_KEY
  if (!apiKey) {
    console.error("SMITHERY_API_KEY is not configured")
    return NextResponse.json(
      { error: "MCP registry is not configured" },
      { status: 500 }
    )
  }

  try {
    const response = await fetch(
      `https://api.smithery.ai/servers/${encodeURIComponent(qualifiedName)}`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        next: { revalidate: 300 },
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Server not found" },
          { status: 404 }
        )
      }
      console.error("Smithery server detail fetch failed:", response.status)
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
      toolCount: data.tools?.length || 0,
      verified: data.verified || false,
      useCount: data.useCount || 0,
    })
  } catch (err) {
    console.error("Smithery server detail error:", err)
    return NextResponse.json(
      { error: "Failed to fetch server details" },
      { status: 500 }
    )
  }
}
