import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { cancelBackgroundAgent, snapshotBackgroundAgent } from "@/lib/agent-session"
import { persistAgentSnapshot } from "../stream/_lib/persist-snapshot"
import { prisma } from "@/lib/db/prisma"
import { releaseTurnSecrets } from "@/lib/server/turn-secrets"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
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

  const { chatId, backgroundSessionId, assistantMessageId } = body ?? {}
  if (typeof chatId !== "string" || !chatId || typeof backgroundSessionId !== "string" || !backgroundSessionId ||
      typeof assistantMessageId !== "string" || !assistantMessageId) {
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

    // A turn that's genuinely still "running" should be keeping its sandbox
    // alive — the cron monitor calls sandbox.refreshActivity() on every tick
    // specifically to prevent auto-stop mid-turn. So by the time Stop is
    // clicked, if the sandbox isn't started, the agent process inside it is
    // already dead (stopping a sandbox kills everything in it) — there is
    // nothing left to cancel, whether the sandbox expired outright or merely
    // auto-stopped. Booting it back up just to perform a now-pointless
    // "cancel" on an already-gone process isn't worth the boot latency; just
    // finalize the turn immediately, same as the confirmed-expired case.
    //
    // Abandoning the claim alone (the old behavior on any failure here)
    // isn't enough: it leaves queuePaused=true and status="running" stuck
    // forever, since nothing else in a retry would ever start the sandbox
    // either. getSandboxOrExpired only short-circuits like this on a
    // confirmed 404 or a resolved-but-not-started sandbox below — a genuine
    // timeout/transient failure still throws and keeps the existing
    // retry-friendly path, since that case might actually recover on its own.
    const sandboxOrExpired = await getSandboxOrExpired(daytona, chat.sandboxId)
    if (sandboxOrExpired instanceof Response || sandboxOrExpired.state !== "started") {
      await releaseTurn(turn, claimId, "error", null, { pauseQueue: true })
      return Response.json({
        success: true,
        warning: "The agent's sandbox was no longer running; its last saved output (if any) was kept, but the run could not be cleanly stopped.",
      })
    }
    const sandbox = sandboxOrExpired

    const sessionOpts = {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
      previewUrlPattern: chat.previewUrlPattern || undefined,
    }

    // Keep the finalization claim until cancellation AND persistence finish.
    // Otherwise periodic/SSE writers lose ownership when Stop releases the
    // turn, leaving the user with a visible reply that vanishes on refresh.
    const before = await snapshotBackgroundAgent(sandbox, backgroundSessionId, sessionOpts)
    if (before.transientReadFailure) throw new Error("Cannot read the agent output; retry Stop")
    if (!before.startupPending && !(await persistAgentSnapshot({ prisma, turn, snapshot: before, finalizationClaimId: claimId })).persisted) {
      throw new Error("Cannot save the agent output; retry Stop")
    }
    // Prepared launches have no output yet. The SDK must fence that exact
    // attempt before release, so a delayed start cannot run after Stop.
    await cancelBackgroundAgent(sandbox, backgroundSessionId, sessionOpts, true)
    const after = await snapshotBackgroundAgent(sandbox, backgroundSessionId, sessionOpts, before)
    if (after.transientReadFailure) throw new Error("Agent stopped but final output could not be read; retry Stop")
    if (after.status === "running") throw new Error("Cannot confirm the agent stopped; retry Stop")
    if (!(await persistAgentSnapshot({ prisma, turn, snapshot: after, finalizationClaimId: claimId })).persisted) {
      throw new Error("Agent stopped but final output could not be saved; retry Stop")
    }
    // Detach the turn secrets before the chat is released below.
    await releaseTurnSecrets(sandbox)

    // Update database to mark chat as ready
    if (!await releaseTurn(turn, claimId, "ready", after.sessionId, { pauseQueue: true })) {
      return Response.json({ error: "Agent turn changed; reload the chat" }, { status: 409 })
    }

    return Response.json({ success: true })
  } catch (error) {
    await abandonFinalization(turn, claimId)
    console.error("[agent/stop] Error:", error)
    return internalError(error)
  }
}
