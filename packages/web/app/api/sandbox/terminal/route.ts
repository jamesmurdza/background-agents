import { Daytona } from "@daytonaio/sdk"
import { setupTerminal, stopTerminal, getTerminalStatus } from "@background-agents/sandbox-terminal"
import { ensureSandboxStarted } from "@/lib/sandbox"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { internalError, badRequest } from "@/lib/db/api-helpers"

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

  if (!body) return badRequest("Invalid JSON body")

  const { sandboxId, action = "setup" } = body
  if (!sandboxId) return badRequest("Missing sandboxId")

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await getSandboxOrExpired(daytona, sandboxId)
    if (sandbox instanceof Response) return sandbox
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
    return internalError(error)
  }
}
