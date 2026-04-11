import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { pollBackgroundAgent } from "@/lib/agent-session"

export async function GET(req: Request) {
  // 1. Parse query params
  const url = new URL(req.url)
  const sandboxId = url.searchParams.get("sandboxId")
  const repoName = url.searchParams.get("repoName")
  const previewUrlPattern = url.searchParams.get("previewUrlPattern")
  const backgroundSessionId = url.searchParams.get("backgroundSessionId")

  if (!sandboxId || !repoName || !backgroundSessionId) {
    return Response.json({ error: "Missing required fields: sandboxId, repoName, backgroundSessionId" }, { status: 400 })
  }

  // 2. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    // 3. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // 4. Poll for events
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
