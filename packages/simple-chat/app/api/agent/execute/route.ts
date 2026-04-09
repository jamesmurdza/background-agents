import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { setBackgroundSessionId } from "@/lib/session-store"

export const maxDuration = 60

export async function POST(req: Request) {
  // 1. Get session and verify auth
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 2. Parse request body
  const body = await req.json()
  const { sandboxId, prompt, repoName, previewUrlPattern } = body

  if (!sandboxId || !prompt || !repoName) {
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

  try {
    // 4. Get sandbox from Daytona
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox

    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      // Sandbox not found
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found" },
        { status: 410 }
      )
    }

    // 5. Start sandbox if not running
    if (sandbox.state !== "started") {
      await sandbox.start(120) // 2 minute timeout
    }

    // 6. Create background agent session
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern,
    })

    // Store the session ID for status polling
    setBackgroundSessionId(sandboxId, bgSession.backgroundSessionId)

    // 7. Start the agent
    await bgSession.start(prompt)

    return Response.json({ success: true })
  } catch (error) {
    console.error("[agent/execute] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
