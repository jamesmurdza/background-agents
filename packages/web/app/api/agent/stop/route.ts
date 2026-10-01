import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { cancelBackgroundAgent } from "@/lib/agent-session"
import { prisma } from "@/lib/db/prisma"
import { abandonFinalization, claimTurnFinalization, releaseTurn } from "@/lib/server/turn-ownership"
import {
  isAuthError,
  requireAuth,
  badRequest,
  serverConfigError,
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

  let body: { chatId: string; backgroundSessionId: string; assistantMessageId: string }
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }

  const { chatId, backgroundSessionId, assistantMessageId } = body
  if (!chatId || !backgroundSessionId || !assistantMessageId) {
    return badRequest("Missing required turn identity")
  }

  // Verify user owns this chat
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      userId: true,
      status: true,
      sandboxId: true,
      backgroundSessionId: true,
      activeAssistantMessageId: true,
      repo: true,
      previewUrlPattern: true,
    },
  })

  if (!chat || chat.userId !== auth.userId) {
    return badRequest("Chat not found")
  }

  if (chat.status !== "running" || chat.backgroundSessionId !== backgroundSessionId ||
      chat.activeAssistantMessageId !== assistantMessageId || !chat.sandboxId) {
    return Response.json({ error: "Agent turn changed; reload the chat" }, { status: 409 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  const turn = { chatId, backgroundSessionId, assistantMessageId }
  const claimId = await claimTurnFinalization(turn)
  if (!claimId) return Response.json({ error: "Agent turn is already finishing" }, { status: 409 })

  try {
    // Pause only the turn the user actually clicked Stop on. A delayed Stop
    // from A must not pause or cancel a newly started B.
    const paused = await prisma.chat.updateMany({
      where: { id: chatId, status: "running", backgroundSessionId, activeAssistantMessageId: assistantMessageId, finalizationClaimId: claimId },
      data: { queuePaused: true },
    })
    if (paused.count !== 1) {
      await abandonFinalization(turn, claimId)
      return Response.json({ error: "Agent turn changed; reload the chat" }, { status: 409 })
    }

    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(chat.sandboxId)

    const sessionOpts = {
      repoPath: `${PATHS.SANDBOX_HOME}/${chat.repo}`,
      previewUrlPattern: chat.previewUrlPattern || undefined,
    }

    // Kill the agent process
    await cancelBackgroundAgent(sandbox, backgroundSessionId, sessionOpts)

    // Update database to mark chat as ready
    if (!await releaseTurn(turn, claimId, "ready")) {
      return Response.json({ error: "Agent turn changed; reload the chat" }, { status: 409 })
    }

    return Response.json({ success: true })
  } catch (error) {
    await abandonFinalization(turn, claimId)
    console.error("[agent/stop] Error:", error)
    return internalError(error)
  }
}
