import { Daytona } from "@daytonaio/sdk"
import { NextRequest } from "next/server"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import {
  decryptUserCredentials,
  getChatWithAuth,
  internalError,
  isAuthError,
  notFound,
  requireAuth,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { buildUsageMeta } from "@/lib/server/shared-pool"
import { logActivityAsync } from "@/lib/db/activity-log"
import { createBackgroundAgentSession, type Agent } from "@/lib/agent-session"
import { loadMcpConnections } from "@/lib/mcp/agent-servers"
import { resolveCliModel } from "@background-agents/common"
import { getUserEndpoints } from "@/lib/server/custom-endpoints"
import {
  deleteSandboxQuietly,
  discoverSkillsForRepo,
  uploadFilesToSandbox,
} from "@/lib/sandbox"
import type { SuccessResponse } from "./_lib/types"
import { parseMessageRequest } from "./_lib/parse-request"
import { resolveSendCredentials } from "./_lib/resolve-credentials"
import { ensureSandboxForChat, type SandboxState } from "./_lib/ensure-sandbox"
import { runPreRunPull } from "./_lib/pre-run-pull"
import { buildAgentHistory } from "./_lib/history"
import { buildAgentEnv } from "./_lib/agent-env"
import { persistTurn } from "./_lib/persist-turn"


export const maxDuration = 300

/**
 * GET /api/chats/[chatId]/messages
 *
 * Returns all messages for a chat.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { timestamp: "asc" },
  })

  // Convert BigInt timestamps to numbers for JSON serialization
  const serializedMessages = messages.map((m) => ({
    ...m,
    timestamp: Number(m.timestamp),
  }))

  return Response.json({ messages: serializedMessages })
}

/**
 * POST /api/chats/[chatId]/messages
 *
 * Single endpoint that orchestrates everything sendMessage used to do
 * across four client → server round-trips:
 *   1. Create the sandbox if the chat doesn't have one yet.
 *   2. Upload any attached files to the sandbox.
 *   3. Persist the user message + assistant placeholder.
 *   4. Start the background agent session.
 *
 * Body is multipart/form-data when there are file attachments
 * (payload + file-0, file-1, …) or application/json otherwise. On any
 * failure after a sandbox was newly created, the sandbox is deleted
 * before we respond, so the chat is never left referencing a leaked
 * sandbox.
 *
 * The per-stage logic lives in `./_lib/*`; this handler is the orchestrator.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth
  const { chatId } = await params

  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  // Per-chat concurrency: refuse re-entry while a previous send is
  // still in flight. This is the server-side equivalent of the client
  // sendInFlight ref; it survives across browser tabs, refreshes, etc.
  if (chat.status === "creating" || chat.status === "running") {
    return Response.json({ error: "Chat is busy" }, { status: 409 })
  }

  // Parse body (JSON or multipart) + validate.
  const parsed = await parseMessageRequest(req)
  if (parsed instanceof Response) return parsed
  const { payload, files } = parsed

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  // Resolve GitHub token + agent credentials and enforce the shared-pool budget.
  const resolved = await resolveSendCredentials(userId, payload)
  if (resolved instanceof Response) return resolved
  const { credentials, githubToken, useSharedClaude } = resolved

  // The user's custom endpoints — used to resolve an `endpoint:<id>` model into
  // the right env vars and --model arg.
  const customEndpoints = await getUserEndpoints(userId)

  const daytona = new Daytona({ apiKey: daytonaApiKey })

  // Seeded from the chat row; kept in sync by ensureSandboxForChat so the
  // catch below can tear down a sandbox newly created during this request.
  const state: SandboxState = {
    sandboxId: chat.sandboxId,
    branch: chat.branch,
    previewUrlPattern: chat.previewUrlPattern,
    createdSandbox: false,
  }

  try {
    // ── Stages 1–2: ensure (or recreate) a started sandbox ─────────────────
    const ensured = await ensureSandboxForChat({
      daytona,
      chat,
      chatId,
      payload,
      githubToken,
      userId,
      state,
    })
    if (ensured instanceof Response) return ensured
    const { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox } = ensured

    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // ── Stage 2b: auto-pull the branch before the agent runs ───────────────
    const pull = await runPreRunPull({
      sandbox,
      repoPath,
      chat,
      chatId,
      branch,
      githubToken,
      createdSandbox,
    })
    if (pull instanceof Response) return pull
    const { pullConflictNote } = pull

    // ── Stage 3: file upload ───────────────────────────────────────────────
    let uploadedFilePaths: string[] = []
    if (files.length > 0) {
      try {
        uploadedFilePaths = await uploadFilesToSandbox(sandbox, PATHS.UPLOADS_DIR, files)
      } catch (err) {
        // Match the legacy behavior: file-upload errors don't abort the
        // send. The agent simply runs without seeing the files.
        console.error("[chats/messages] file upload failed:", err)
      }
    }

    // Build the prompt the agent sees. Mirrors the legacy client logic.
    let agentPrompt = pullConflictNote + payload.message
    if (uploadedFilePaths.length > 0) {
      agentPrompt +=
        "\n\n---\nUploaded files:\n" +
        uploadedFilePaths.map((p) => `- ${p}`).join("\n")
    }

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
    const usageMeta = buildUsageMeta(
      payload.agent as Agent,
      decryptUserCredentials(storedUser?.credentials as Record<string, unknown> | null),
      payload.model
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
    await bgSession.start(agentPrompt, history ? { history } : undefined)

    // Log message sent activity (fire and forget)
    // Include useSharedClaude flag to track shared Claude subscription usage
    logActivityAsync(userId, "message_sent", {
      chatId,
      agent: payload.agent,
      model: payload.model,
      useSharedClaude,
    })

    const response: SuccessResponse = {
      sandboxId,
      branch,
      previewUrlPattern,
      backgroundSessionId: bgSession.backgroundSessionId,
      uploadedFiles: uploadedFilePaths,
    }
    return Response.json(response)
  } catch (error) {
    console.error("[chats/messages] Error:", error)

    // If we just created the sandbox in this request and something
    // downstream failed, delete it so it's not orphaned.
    if (state.createdSandbox && state.sandboxId) {
      await deleteSandboxQuietly(daytona, state.sandboxId)
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: {
            sandboxId: null,
            branch: null,
            previewUrlPattern: null,
            status: "error",
          },
        })
      } catch {
        /* best effort */
      }
    } else {
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: { status: "error" },
        })
      } catch {
        /* best effort */
      }
    }

    return internalError(error)
  }
}
