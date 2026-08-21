import { PATHS } from "@/lib/constants"
import { cancelBackgroundAgent } from "@/lib/agent-session"
import { prisma } from "@/lib/db/prisma"
import {
  isAuthError,
  requireAuth,
  badRequest,
  requireDaytona,
  internalError,
} from "@/lib/db/api-helpers"

/**
 * POST /api/agent/stop
 *
 * Explicitly stops a running agent. This is called when the user clicks the
 * stop button, as opposed to simply disconnecting (closing browser, network
 * issues, etc.) which should NOT stop the agent.
 */
export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  let body: { chatId: string }
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }

  const { chatId } = body
  if (!chatId) {
    return badRequest("Missing required field: chatId")
  }

  // Verify user owns this chat
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      userId: true,
      sandboxId: true,
      backgroundSessionId: true,
      repo: true,
      previewUrlPattern: true,
    },
  })

  if (!chat || chat.userId !== auth.userId) {
    return badRequest("Chat not found")
  }

  if (!chat.backgroundSessionId || !chat.sandboxId) {
    // Agent is not running, nothing to stop
    return Response.json({ success: true, message: "Agent not running" })
  }

  const daytona = requireDaytona()
  if (daytona instanceof Response) return daytona

  try {
    const sandbox = await daytona.get(chat.sandboxId)

    const sessionOpts = {
      repoPath: `${PATHS.SANDBOX_HOME}/${chat.repo}`,
      previewUrlPattern: chat.previewUrlPattern || undefined,
    }

    // Kill the agent process
    await cancelBackgroundAgent(sandbox, chat.backgroundSessionId, sessionOpts)

    // Update database to mark chat as ready
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        status: "ready",
        backgroundSessionId: null,
      },
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error("[agent/stop] Error:", error)
    return internalError(error)
  }
}
