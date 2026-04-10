import { Daytona } from "@daytonaio/sdk"

export async function POST(req: Request) {
  const body = await req.json()
  const { sandboxId } = body

  if (!sandboxId) {
    return Response.json({ error: "Missing sandboxId" }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()

    return Response.json({ success: true })
  } catch (error) {
    console.error("[sandbox/delete] Error:", error)
    // Don't fail if sandbox doesn't exist - it may have already been deleted
    const message = error instanceof Error ? error.message : "Unknown error"
    if (message.includes("not found") || message.includes("404")) {
      return Response.json({ success: true, alreadyDeleted: true })
    }
    return Response.json({ error: message }, { status: 500 })
  }
}
