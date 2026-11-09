import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import {
  agentModels,
  getDefaultAgent,
  resolveAgent,
  resolveModelForAgent,
  hasCredentialsForModel,
  type Agent,
} from "@background-agents/common"
import { getEffectiveCredentialFlags } from "@/lib/server/credential-flags"
import { toQueuedMessage } from "@/lib/server/prompt-queue"

// =============================================================================
// Types
// =============================================================================

interface ChatResponse {
  id: string
  repo: string
  baseBranch: string
  branch: string | null
  sandboxId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string | null
  activeAssistantMessageId: string | null
  agent: string
  model: string | null
  planModeEnabled: boolean
  displayName: string | null
  shareId: string | null
  status: string
  archived: boolean
  pinned: boolean
  parentChatId: string | null
  needsSync: boolean
  uncommittedFilesCount: number
  hasCommits: boolean
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  messageCount: number
  lastMessageId: string | null
  queuedMessages: ReturnType<typeof toQueuedMessage>[]
  queuePaused: boolean
  /** Present only when this chat was created by a scheduled job run. Null for
   *  ordinary user-created chats. See startJobExecution in the agent-lifecycle
   *  cron — these chats never get a displayName, so the sidebar derives a
   *  title from the job name + run time instead. */
  scheduledJobRun: { startedAt: number; jobName: string } | null
}

// =============================================================================
// GET - List all chats for user
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { searchParams } = new URL(req.url)
    const updatedAfter = searchParams.get("updatedAfter")

    const chats = await prisma.chat.findMany({
      where: {
        userId,
        ...(updatedAfter && {
          updatedAt: { gt: new Date(parseInt(updatedAfter)) },
        }),
      },
      include: {
        queuedPrompts: {
          where: { status: { in: ["queued", "dispatching"] } },
          orderBy: { position: "asc" },
        },
        messages: {
          select: { id: true },
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        _count: {
          select: { messages: true },
        },
        // Chats created by scheduled job runs (startJobExecution) show in the
        // sidebar now too, but they never get a displayName — the sidebar
        // derives a title from the job name + run start time instead.
        scheduledJobRun: {
          select: { startedAt: true, job: { select: { name: true } } },
        },
      },
      orderBy: { lastActiveAt: "desc" },
    })

    const response: ChatResponse[] = chats.map((chat) => ({
      id: chat.id,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      activeAssistantMessageId: chat.activeAssistantMessageId,
      agent: chat.agent,
      model: chat.model,
      planModeEnabled: chat.planModeEnabled,
      displayName: chat.displayName,
      shareId: chat.shareId,
      status: chat.status,
      archived: chat.archived,
      pinned: chat.pinned,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      uncommittedFilesCount: chat.uncommittedFilesCount,
      hasCommits: chat.hasCommits,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
      messageCount: chat._count.messages,
      lastMessageId: chat.messages[0]?.id ?? null,
      queuedMessages: chat.queuedPrompts.map(toQueuedMessage),
      queuePaused: chat.queuePaused,
      scheduledJobRun: chat.scheduledJobRun
        ? { startedAt: chat.scheduledJobRun.startedAt.getTime(), jobName: chat.scheduledJobRun.job.name }
        : null,
    }))

    return Response.json({ chats: response })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// POST - Create a new chat
// =============================================================================

interface CreateChatBody {
  repo: string
  baseBranch?: string
  parentChatId?: string
  agent?: string
  model?: string
  status?: string
  planModeEnabled?: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateChatBody = await req.json()

    if (!body.repo) {
      return badRequest("repo is required")
    }

    // Validate parentChatId if provided
    if (body.parentChatId) {
      const parentChat = await prisma.chat.findUnique({
        where: { id: body.parentChatId },
        select: { userId: true },
      })
      if (!parentChat || parentChat.userId !== userId) {
        return badRequest("Invalid parentChatId")
      }
    }

    // Pick an (agent, model) pair that's actually usable with the user's
    // credentials. Without this the row could have e.g. agent="opencode"
    // (the hardcoded default) but model="claude-sonnet-..." (settings'
    // default), which is internally inconsistent and confuses the UI.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    })
    const userSettings = (user?.settings as { defaultAgent?: string; defaultModel?: string } | null) ?? {}
    const { flags } = await getEffectiveCredentialFlags(userId)

    const requestedAgent = resolveAgent(body.agent, userSettings.defaultAgent)
    const requestedAgentUsable = (agentModels[requestedAgent] ?? []).some((m) =>
      hasCredentialsForModel(m, flags, requestedAgent)
    )
    const finalAgent: Agent = requestedAgentUsable
      ? requestedAgent
      : getDefaultAgent()

    const finalModel: string =
      body.model ?? resolveModelForAgent(finalAgent, flags, userSettings.defaultModel)

    const chat = await prisma.chat.create({
      data: {
        userId,
        repo: body.repo,
        baseBranch: body.baseBranch ?? "main",
        parentChatId: body.parentChatId,
        agent: finalAgent,
        model: finalModel,
        status: body.status ?? "pending",
        planModeEnabled: body.planModeEnabled ?? false,
      },
    })

    const response: ChatResponse = {
      id: chat.id,
      repo: chat.repo,
      baseBranch: chat.baseBranch,
      branch: chat.branch,
      sandboxId: chat.sandboxId,
      sessionId: chat.sessionId,
      previewUrlPattern: chat.previewUrlPattern,
      backgroundSessionId: chat.backgroundSessionId,
      activeAssistantMessageId: chat.activeAssistantMessageId,
      agent: chat.agent,
      model: chat.model,
      planModeEnabled: chat.planModeEnabled,
      displayName: chat.displayName,
      shareId: chat.shareId,
      status: chat.status,
      archived: chat.archived,
      pinned: chat.pinned,
      parentChatId: chat.parentChatId,
      needsSync: chat.needsSync,
      uncommittedFilesCount: chat.uncommittedFilesCount,
      hasCommits: chat.hasCommits,
      createdAt: chat.createdAt.getTime(),
      updatedAt: chat.updatedAt.getTime(),
      lastActiveAt: chat.lastActiveAt.getTime(),
      messageCount: 0,
      lastMessageId: null,
      queuedMessages: [],
      queuePaused: false,
      // POST-created chats are user-initiated, never scheduled-job-linked.
      scheduledJobRun: null,
    }

    // Log activity (fire and forget)
    logActivityAsync(userId, "chat_created", {
      chatId: chat.id,
      repo: chat.repo,
      agent: chat.agent,
      model: chat.model ?? undefined,
    })

    return Response.json(response, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
