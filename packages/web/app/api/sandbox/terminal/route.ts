import { Daytona } from "@daytonaio/sdk"
import { setupTerminal, stopTerminal, getTerminalStatus } from "@upstream/daytona-terminal"
import { ensureSandboxStarted } from "@/lib/sandbox"

export const maxDuration = 60

/**
 * POST /api/sandbox/terminal
 *
 * Provisions a WebSocket PTY server inside the sandbox and returns the
 * signed wss:// URL the browser can connect to.
 *
 * Body: { sandboxId: string, action?: "setup" | "status" | "stop" }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sandboxId?: string
    action?: "setup" | "status" | "stop"
  } | null

  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 })

  const { sandboxId, action = "setup" } = body
  if (!sandboxId) return Response.json({ error: "Missing sandboxId" }, { status: 400 })

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })
    }
    await ensureSandboxStarted(sandbox)

    switch (action) {
      case "status": {
        const result = await getTerminalStatus(sandbox)
        return Response.json(result)
      }
      case "stop": {
        const result = await stopTerminal(sandbox)
        return Response.json(result)
      }
      case "setup":
      default: {
        const result = await setupTerminal(sandbox)
        if (result.status === "error") {
          return Response.json(result, { status: 500 })
        }
        return Response.json(result)
      }
    }
  } catch (error) {
    console.error("[sandbox/terminal] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
