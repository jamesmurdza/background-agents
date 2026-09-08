/**
 * Start an agent turn for a chat whose sandbox is ready and whose inputs are
 * already resolved.
 *
 * Extracted verbatim from the POST /api/chats/[chatId]/messages handler so two
 * callers can drive the same path: the handler itself (the normal case) and the
 * setup dispatcher (a turn held while the environment's setup script ran). The
 * body below is a move, not a rewrite. The only change is `setupFailureNote`,
 * which is prepended to the string handed to the agent (and only that string:
 * the persisted user message stays exactly what the user typed, so the note
 * cannot show up as the user's own words or double on a re-dispatch).
 *
 * The moved body keeps the indentation it had inside the route's `try` block so
 * the move stays diffable line for line against the original.
 */

import type { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import { NEW_REPOSITORY } from "@/lib/types"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import { buildUsageMeta } from "@/lib/server/shared-pool"
import { logActivityAsync } from "@/lib/db/activity-log"
import { createBackgroundAgentSession, type Agent } from "@/lib/agent-session"
import { loadMcpConnections } from "@/lib/mcp/agent-servers"
import { resolveCliModel, type CustomEndpoint } from "@background-agents/common"
import { discoverSkillsForRepo } from "@/lib/sandbox"
import type { Credentials } from "@/lib/credentials"
import type { ChatRecord, MessagePayload } from "@/app/api/chats/[chatId]/messages/_lib/types"
import { buildAgentHistory } from "@/app/api/chats/[chatId]/messages/_lib/history"
import { buildAgentEnv } from "@/app/api/chats/[chatId]/messages/_lib/agent-env"
import { persistTurn } from "@/app/api/chats/[chatId]/messages/_lib/persist-turn"

type DaytonaSandbox = Awaited<ReturnType<Daytona["get"]>>

export interface RunQueuedTurnParams {
  sandbox: DaytonaSandbox
  chat: ChatRecord
  chatId: string
  userId: string
  payload: MessagePayload
  credentials: Credentials
  customEndpoints: CustomEndpoint[]
  repoPath: string
  previewUrlPattern: string | null
  /** The exact text persisted as the user message. */
  agentPrompt: string
  uploadedFilePaths: string[]
  useSharedClaude: boolean
  /** Prepended to the agent's prompt when the environment's setup script failed. */
  setupFailureNote: string | null
}

export async function runQueuedTurnForChat(
  params: RunQueuedTurnParams
): Promise<{ backgroundSessionId: string }> {
  const {
    sandbox,
    chat,
    chatId,
    userId,
    payload,
    credentials,
    customEndpoints,
    repoPath,
    previewUrlPattern,
    agentPrompt,
    uploadedFilePaths,
    useSharedClaude,
    setupFailureNote,
  } = params

    // Decide what prior conversation to replay (agent switch / chat fork).
    const { history, isAgentSwitch } = await buildAgentHistory(chatId, chat, payload)

    // ── Stage 4: spin up the background session (does NOT start the agent yet) ──
    const env = await buildAgentEnv({ chat, userId, payload, credentials, customEndpoints })

    // Fetch this chat's connected MCP servers so the agent sees them as tools.
    // Best-effort — a fetch error shouldn't block the turn.
    let mcpServers: Awaited<ReturnType<typeof loadMcpConnections>> = []
    try {
      mcpServers = await loadMcpConnections({ kind: "chat", id: chatId })
    } catch (err) {
      console.error("[messages] loadMcpConnections failed:", err)
    }

    // ── Stage 3b: discover installed skills ───────────────────────────────
    // Scan .agents/skills/ to build the skill catalog for the system prompt.
    // Runs on every message so the catalog stays current (e.g. skills added
    // between turns or committed in the repo). Best-effort — never blocks.
    let discoveredSkills: { name: string; description: string; location: string }[] = []
    if (chat.repo !== NEW_REPOSITORY) {
      discoveredSkills = await discoverSkillsForRepo(sandbox, repoPath)
    }

    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern: previewUrlPattern ?? undefined,
      // On agent switch, don't pass the old agent's sessionId — it would crash the new CLI
      sessionId: isAgentSwitch ? undefined : (chat.sessionId ?? undefined),
      agent: payload.agent as Agent,
      model: resolveCliModel(payload.model, customEndpoints),
      env: Object.keys(env).length > 0 ? env : undefined,
      planMode: payload.planMode,
      mcpServers,
      skills: discoveredSkills.length > 0 ? discoveredSkills : undefined,
    })

    // Resolve the credential pool for this run (shared vs the user's own key)
    // from DB-stored creds only — process.env keys must read as shared. Stamped
    // on the assistant message so the turn finalizer (cron) can attribute usage.
    const storedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { credentials: true },
    })
    // `credentials` carries the key actually handed to the agent — for a shared
    // OpenCode run that's the one pickSharedOpencodeKey chose for this turn, so
    // fingerprinting it here is what makes per-key spend attributable later.
    const usageMeta = buildUsageMeta(
      payload.agent as Agent,
      decryptUserCredentials(storedUser?.credentials as Record<string, unknown> | null),
      payload.model,
      credentials.OPENCODE_API_KEY
    )

    // ── Stage 5: persist messages + chat status (transactional) ────────────
    await persistTurn({
      chatId,
      payload,
      agentPrompt,
      uploadedFilePaths,
      usageMeta,
      backgroundSessionId: bgSession.backgroundSessionId,
      isAgentSwitch,
    })

    // ── Stage 6: kick off the agent ────────────────────────────────────────
    // The one line the extraction adds: a failed setup script tells the agent
    // what broke. Deliberately NOT part of `agentPrompt`, which is what was
    // persisted as the user's message.
    const promptForAgent = setupFailureNote
      ? `${setupFailureNote}\n\n---\n\n${agentPrompt}`
      : agentPrompt
    await bgSession.start(promptForAgent, history ? { history } : undefined)

    // Log message sent activity (fire and forget)
    // Include useSharedClaude flag to track shared Claude subscription usage
    logActivityAsync(userId, "message_sent", {
      chatId,
      agent: payload.agent,
      model: payload.model,
      useSharedClaude,
    })

  return { backgroundSessionId: bgSession.backgroundSessionId }
}
