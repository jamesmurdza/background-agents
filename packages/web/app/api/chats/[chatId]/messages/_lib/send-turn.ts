import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { randomUUID } from "node:crypto"
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
import { toSecretMarker } from "@background-agents/sandbox-secrets"
import {
  applyTurnSecretsToEnv,
  ensureTurnSecrets,
  mountTurnSecrets,
  planTurnSecrets,
  poolSecretOf,
  releaseTurnSecrets,
  waitForTurnSecrets,
} from "@/lib/server/turn-secrets"
import { logActivityAsync } from "@/lib/db/activity-log"
import { createBackgroundAgentSession, type Agent } from "@/lib/agent-session"
import { loadMcpConnections } from "@/lib/mcp/agent-servers"
import { resolveCliModel } from "@background-agents/common"
import { getUserEndpoints } from "@/lib/server/custom-endpoints"
import { buildSharedClaudeEnv } from "@/lib/server/claude-token-auth"
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
  const { credentials, githubToken, useSharedClaude, claudeToken } = resolved
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

  // Secrets for this run's keys (shared pools, subscriptions and the user's own), if any.
  const plannedSecrets = planTurnSecrets({
    userId, agent: payload.agent as Agent, model: payload.model, credentials, endpoints: customEndpoints,
    claudeToken,
  })
  // Set once the sandbox is known, so a turn that never starts detaches its secrets again.
  let secretSandbox: DaytonaSandbox | undefined

  try {
    // Created on first use; needed before the sandbox below is created with
    // them or they are mounted.
    const turnSecrets = await ensureTurnSecrets(daytona, plannedSecrets)

    const ensured = await ensureSandboxForChat({
      daytona, chat, chatId, payload, githubToken, userId, state, turnSecrets,
    })
    if (ensured instanceof Response) return ensured
    const { sandbox, sandboxId, branch, previewUrlPattern, createdSandbox, branchRestored } = ensured

    // Mount this turn's secrets now, so Daytona's propagation delay overlaps
    // the pull/upload work below. Detached again wherever the turn ends (see
    // lib/server/turn-secrets).
    secretSandbox = sandbox
    const mountedSecrets = await mountTurnSecrets(sandbox, turnSecrets)
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
    // A Claude subscription run (shared or the user's own) fetches its token
    // through the token runner, keyed to this session.
    const backgroundSessionId = claudeToken ? randomUUID() : undefined
    let env = await buildAgentEnv({ chat, userId, payload, credentials, customEndpoints })
    if (backgroundSessionId && claudeToken) {
      env = buildSharedClaudeEnv(env, { userId, chatId, backgroundSessionId, source: claudeToken.source })
    }
    // Hand the agent the mounted secrets' placeholders instead of the keys.
    applyTurnSecretsToEnv(env, turnSecrets)
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
      backgroundSessionId,
      repoPath,
      previewUrlPattern: previewUrlPattern ?? undefined,
      sessionId: isAgentSwitch ? undefined : (chat.sessionId ?? undefined),
      agent: payload.agent as Agent,
      model: resolveCliModel(payload.model, customEndpoints),
      env: Object.keys(env).length > 0 ? env : undefined,
      planMode: payload.planMode,
      reasoningEffort: payload.reasoningEffort,
      mcpServers,
      skills: discoveredSkills.length > 0 ? discoveredSkills : undefined,
    })

    const storedUser = await prisma.user.findUnique({
      where: { id: userId }, select: { credentials: true },
    })
    // The key actually handed to the agent — for a shared pool run that's
    // the secret the sandbox has mounted — so fingerprinting it here is what
    // makes per-key spend attributable later.
    const poolSecretName = poolSecretOf(turnSecrets)
    const usageMeta = buildUsageMeta(
      payload.agent as Agent,
      decryptUserCredentials(storedUser?.credentials as Record<string, unknown> | null),
      payload.model,
      poolSecretName ? toSecretMarker(poolSecretName) : credentials.OPENCODE_API_KEY
    )

    await persistTurn({
      chatId, payload, agentPrompt, uploadedFilePaths, usageMeta,
      backgroundSessionId: bgSession.backgroundSessionId,
      isAgentSwitch,
      claimedPromptId,
    })
    turnPersisted = true
    await waitForTurnSecrets(mountedSecrets)
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
    // Once persisted, a failed start response does not prove the process
    // failed to launch. Keep its durable identity and sandbox so Stop/cron
    // can recover or fence the same attempt before another one is admitted.
    if (turnPersisted) return internalError(error)
    try {
      const changed = await prisma.chat.updateMany({
        where: { id: chatId, status: "creating", queueDispatchId: claimedPromptId ?? null },
        data: {
          status: "error",
          queueDispatchId: claimedPromptId ?? null,
          ...(state.createdSandbox && { sandboxId: null, branch: null, previewUrlPattern: null }),
        },
      })
      if (changed.count === 1 && state.createdSandbox && state.sandboxId) {
        await deleteSandboxQuietly(daytona, state.sandboxId)
      }
    } catch { /* best effort; cron can recover a persisted turn */ }
    return internalError(error)
  } finally {
    // The turn never started, so nothing else will detach the secret. A
    // persisted turn keeps it: Stop/cron finalize detach it with the turn.
    if (!turnPersisted && secretSandbox) await releaseTurnSecrets(secretSandbox)
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
