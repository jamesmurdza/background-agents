import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { getEnvForModel } from "@upstream/common"

export const maxDuration = 60

export async function POST(req: Request) {
  // 1. Parse request body
  const body = await req.json()
  const { sandboxId, sessionId, prompt, repoName, previewUrlPattern, agent, model, anthropicApiKey, anthropicAuthToken, openaiApiKey, opencodeApiKey, geminiApiKey, needsSync } = body

  if (!sandboxId || !prompt || !repoName) {
    return Response.json({ error: "Missing required fields: sandboxId, prompt, repoName" }, { status: 400 })
  }

  // 2. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  // Get GitHub token for git pull if needed
  const session = await getServerSession(authOptions)
  const githubToken = session?.accessToken

  try {
    // 3. Get sandbox from Daytona
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

    // 4. Start sandbox if not running
    const wasStarted = sandbox.state === "started"
    if (!wasStarted) {
      await sandbox.start(120) // 2 minute timeout
    }

    // 5. Pull if needsSync (branch was target of merge while sandbox was stopped)
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
    let synced = false
    if (needsSync && githubToken) {
      try {
        await sandbox.git.pull(repoPath, "x-access-token", githubToken)
        synced = true
      } catch {
        // Best effort - continue with execution
      }
    }

    // 6. Build fresh env vars for the agent based on current credentials
    // This is a pure function - no accumulation, returns only what's needed now
    const env = getEnvForModel(model, agent || "opencode", {
      anthropicApiKey,
      anthropicAuthToken,
      openaiApiKey,
      opencodeApiKey,
      geminiApiKey,
    })

    // 7. Create background agent session
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern,
      sessionId: sessionId || undefined,  // Pass existing session ID for conversation continuity
      agent: agent || "opencode",
      model,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    // 8. Start the agent
    await bgSession.start(prompt)

    return Response.json({
      backgroundSessionId: bgSession.backgroundSessionId,
      status: "running",
      synced,
    })
  } catch (error) {
    console.error("[agent/execute] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
