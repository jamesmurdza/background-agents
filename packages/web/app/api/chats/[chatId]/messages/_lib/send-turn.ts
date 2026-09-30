import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import {
  decryptUserCredentials,
  getChatWithAuth,
  internalError,
  notFound,
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
import type { MessagePayload, SuccessResponse } from "./types"
import { resolveSendCredentials } from "./resolve-credentials"
import { ensureSandboxForChat, type SandboxState } from "./ensure-sandbox"
import { runPreRunPull } from "./pre-run-pull"
import { buildAgentHistory } from "./history"
import { buildAgentEnv } from "./agent-env"
import { persistTurn } from "./persist-turn"

interface SendTurnArgs {
  userId: string
  chatId: string
  payload: MessagePayload
  files: File[]
  /** Set only after a queue worker atomically reserves this chat and prompt. */
  claimedPromptId?: string
}

/**
 * Shared agent-start path for an interactive send and a server-owned queued
 * prompt. This keeps credentials, budgets, sandbox setup, history, and turn
 * persistence identical instead of teaching the cron a second send path.
 */
export async function sendChatTurn({
  userId, chatId, payload, files, claimedPromptId,
}: SendTurnArgs): Promise<Response> {
  const chat = await getChatWithAuth(chatId, userId)
  if (!chat) return notFound("Chat not found")

  if (claimedPromptId) {
    if (chat.status !== "creating" || chat.queueDispatchId !== claimedPromptId) {
      return Response.json({ error: "Queue claim is no longer active" }, { status: 409 })
    }
  } else if (chat.status === "creating" || chat.status === "running") {
    return Response.json({ error: "Chat is busy" }, { status: 409 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  // Perform checks before a direct send claims the chat. A queue worker has
  // already reserved it; its caller releases/pauses the claim on any failure.
  const resolved = await resolveSendCredentials(userId, payload)
  if (resolved instanceof Response) return resolved
  const { credentials, githubToken, useSharedClaude } = resolved
  const customEndpoints = await getUserEndpoints(userId)

  if (!claimedPromptId) {
    const claimed = await prisma.chat.updateMany({
      where: {
        id: chatId,
        userId,
        status: { in: ["pending", "ready", "error"] },
        backgroundSessionId: null,
        queueDispatchId: null,
      },
      data: { status: "creating" },
    })
    if (claimed.count !== 1) {
      return Response.json({ error: "Chat is busy" }, { status: 409 })
    }
  }

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const state: SandboxState = {
    sandboxId: chat.sandboxId,
    branch: chat.branch,
    previewUrlPattern: chat.previewUrlPattern,
    createdSandbox: false,
  }
  let turnPersisted = false

  try {
    const ensured = await ensureSandboxForChat({
      daytona, chat, chatId, payload, githubToken, userId, state,
    })
    if (ensured instanceof Response) return ensured
    const { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox, branchRestored } = ensured
    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    const pull = await runPreRunPull({
      sandbox, repoPath, chat, chatId, branch, githubToken, createdSandbox, branchRestored,
    })
    if (pull instanceof Response) return pull
    const { pullConflictNote } = pull

    let uploadedFilePaths: string[] = []
    if (files.length > 0) {
      try {
        uploadedFilePaths = await uploadFilesToSandbox(sandbox, PATHS.UPLOADS_DIR, files)
      } catch (error) {
        console.error("[chats/messages] file upload failed:", error)
      }
    }
    let agentPrompt = pullConflictNote + payload.message
    if (uploadedFilePaths.length > 0) {
      agentPrompt += "\n\n---\nUploaded files:\n" + uploadedFilePaths.map((path) => `- ${path}`).join("\n")
    }

    const { history, isAgentSwitch } = await buildAgentHistory(chatId, chat, payload)
    const env = await buildAgentEnv({ chat, userId, payload, credentials, customEndpoints })
    let mcpServers: Awaited<ReturnType<typeof loadMcpConnections>> = []
    try {
      mcpServers = await loadMcpConnections({ kind: "chat", id: chatId })
    } catch (error) {
      console.error("[messages] loadMcpConnections failed:", error)
    }

    let discoveredSkills: { name: string; description: string; location: string }[] = []
    if (chat.repo !== NEW_REPOSITORY) {
      discoveredSkills = await discoverSkillsForRepo(sandbox, repoPath)
    }
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern: previewUrlPattern ?? undefined,
      sessionId: isAgentSwitch ? undefined : (chat.sessionId ?? undefined),
      agent: payload.agent as Agent,
      model: resolveCliModel(payload.model, customEndpoints),
      env: Object.keys(env).length > 0 ? env : undefined,
      planMode: payload.planMode,
      mcpServers,
      skills: discoveredSkills.length > 0 ? discoveredSkills : undefined,
    })

    const storedUser = await prisma.user.findUnique({
      where: { id: userId }, select: { credentials: true },
    })
    const usageMeta = buildUsageMeta(
      payload.agent as Agent,
      decryptUserCredentials(storedUser?.credentials as Record<string, unknown> | null),
      payload.model
    )

    await persistTurn({
      chatId, payload, agentPrompt, uploadedFilePaths, usageMeta,
      backgroundSessionId: bgSession.backgroundSessionId,
      isAgentSwitch,
      claimedPromptId,
    })
    turnPersisted = true
    await bgSession.start(agentPrompt, history ? { history } : undefined)

    logActivityAsync(userId, "message_sent", {
      chatId, agent: payload.agent, model: payload.model, useSharedClaude,
    })

    const response: SuccessResponse = {
      sandboxId, branch, previewUrlPattern,
      backgroundSessionId: bgSession.backgroundSessionId,
      uploadedFiles: uploadedFilePaths,
    }
    return Response.json(response)
  } catch (error) {
    console.error("[chats/messages] Error:", error)
    if (state.createdSandbox && state.sandboxId) {
      await deleteSandboxQuietly(daytona, state.sandboxId)
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: {
            sandboxId: null, branch: null, previewUrlPattern: null,
            status: "error", queueDispatchId: !turnPersisted ? claimedPromptId ?? null : null,
          },
        })
      } catch { /* best effort */ }
    } else {
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: { status: "error", queueDispatchId: !turnPersisted ? claimedPromptId ?? null : null },
        })
      } catch { /* best effort */ }
    }
    return internalError(error)
  } finally {
    // A pre-run rejection must not strand a direct send in "creating".
    // Queue claims are released by the caller, which also pauses the queue.
    if (!turnPersisted && !claimedPromptId) {
      await prisma.chat.updateMany({
        where: { id: chatId, status: "creating", queueDispatchId: null },
        data: { status: chat.status },
      })
    }
  }
}
