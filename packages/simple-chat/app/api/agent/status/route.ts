import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { pollBackgroundAgent } from "@/lib/agent-session"
import { getBackgroundSessionId } from "@/lib/session-store"

export async function GET(req: Request) {
  // 1. Parse query params
  const url = new URL(req.url)
  const sandboxId = url.searchParams.get("sandboxId")
  const repoName = url.searchParams.get("repoName")
  const previewUrlPattern = url.searchParams.get("previewUrlPattern")

  if (!sandboxId || !repoName) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // 3. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  // 4. Get background session ID
  const backgroundSessionId = getBackgroundSessionId(sandboxId)
  if (!backgroundSessionId) {
    return Response.json(
      { error: "No active session for this sandbox" },
      { status: 404 }
    )
  }

  try {
    // 5. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // 6. Poll for events
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

    const result = await pollBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath,
      previewUrlPattern: previewUrlPattern || undefined,
    })

    return Response.json(result)
  } catch (error) {
    console.error("[agent/status] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json(
      {
        status: "error",
        content: "",
        toolCalls: [],
        contentBlocks: [],
        error: message,
      },
      { status: 500 }
    )
  }
}
