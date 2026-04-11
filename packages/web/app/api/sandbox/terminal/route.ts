import { prisma } from "@/lib/db/prisma"
import { ensureSandboxStarted } from "@/lib/sandbox/sandbox-resume"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
} from "@/lib/shared/api-helpers"
import {
  setupTerminal,
  stopTerminal,
  getTerminalStatus,
} from "@upstream/terminal"

// Timeout for terminal setup - 60 seconds
export const maxDuration = 60

/**
 * POST /api/sandbox/terminal
 *
 * Sets up a WebSocket PTY terminal server in the sandbox.
 * Returns the WebSocket URL for connecting from the browser.
 *
 * Request body:
 *   - sandboxId: string - The sandbox ID
 *   - action: "setup" | "status" | "stop"
 *
 * Response:
 *   - websocketUrl: string - The WebSocket URL to connect to
 *   - httpsUrl: string - The HTTPS URL for health checks
 *   - status: "running" | "starting" | "stopped" | "error"
 */
export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  let body: {
    sandboxId?: string
    action?: "setup" | "status" | "stop"
  }

  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid or empty JSON body")
  }

  const { sandboxId, action = "setup" } = body

  if (!sandboxId) {
    return badRequest("Missing sandboxId")
  }

  console.log(`[terminal] action=${action} sandboxId=${sandboxId}`)

  // Verify ownership
  const sandboxRecord = await prisma.sandbox.findUnique({
    where: { sandboxId },
  })

  if (!sandboxRecord || sandboxRecord.userId !== auth.userId) {
    return notFound("Sandbox not found")
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  try {
    const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)

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
  } catch (error: unknown) {
    console.error("[terminal] Error:", error)
    return internalError(error)
  }
}
