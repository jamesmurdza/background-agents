import { Daytona } from "@daytonaio/sdk"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { getServerSession } from "next-auth"
import { randomUUID } from "crypto"

import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import {
  badRequest,
  getChatWithAuth,
  getUserCredentials,
  internalError,
  isAuthError,
  notFound,
  requireAuth,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { createBackgroundAgentSession, type Agent } from "@/lib/agent-session"
import { getEnvForModel } from "@upstream/common"
import {
  createSandboxForChat,
  deleteSandboxQuietly,
  uploadFilesToSandbox,
} from "@/lib/sandbox"

export const maxDuration = 300

interface MessagePayload {
  message: string
  agent: string
  model: string
  userMessageId: string
  assistantMessageId: string
  /** Branch name for the new sandbox if one is being created. Generated server-side if omitted. */
  newBranch?: string
}

interface SuccessResponse {
  sandboxId: string
  branch: string | null
  previewUrlPattern: string | null
  backgroundSessionId: string
  uploadedFiles: string[]
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

  // Parse body (JSON or multipart)
  let payload: MessagePayload
  let files: File[] = []
  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData()
    const payloadJson = formData.get("payload")
    if (typeof payloadJson !== "string") return badRequest("Missing payload")
    try {
      payload = JSON.parse(payloadJson) as MessagePayload
    } catch {
      return badRequest("Invalid payload JSON")
    }
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("file-") && value instanceof File) files.push(value)
    }
  } else {
    payload = (await req.json()) as MessagePayload
  }

  if (
    !payload.message ||
    !payload.agent ||
    !payload.model ||
    !payload.userMessageId ||
    !payload.assistantMessageId
  ) {
    return badRequest("Missing required fields")
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  const session = await getServerSession(authOptions)
  const githubToken = session?.accessToken

  const credentials = await getUserCredentials(userId)
  const daytona = new Daytona({ apiKey: daytonaApiKey })

  let sandboxId = chat.sandboxId
  let branch = chat.branch
  let previewUrlPattern = chat.previewUrlPattern
  let createdSandbox = false

  try {
    // ── Stage 1: ensure sandbox ────────────────────────────────────────────
    if (!sandboxId) {
      await prisma.chat.update({
        where: { id: chatId },
        data: { status: "creating" },
      })

      const newBranch = payload.newBranch ?? `agent/${randomUUID().slice(0, 8)}`
      const created = await createSandboxForChat({
        daytona,
        repo: chat.repo,
        baseBranch: chat.baseBranch ?? "main",
        newBranch,
        githubToken,
        userId,
      })
      sandboxId = created.sandboxId
      branch = created.branch
      previewUrlPattern = created.previewUrlPattern ?? null
      createdSandbox = true

      await prisma.chat.update({
        where: { id: chatId },
        data: {
          sandboxId,
          branch,
          previewUrlPattern,
          status: "ready",
        },
      })
    }

    // ── Stage 2: get sandbox object ────────────────────────────────────────
    let sandbox: Awaited<ReturnType<Daytona["get"]>>
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      // Stale sandbox reference. Clear it so the next send creates fresh.
      await prisma.chat.update({
        where: { id: chatId },
        data: { sandboxId: null, branch: null, previewUrlPattern: null, status: "error" },
      })
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found" },
        { status: 410 }
      )
    }

    if (sandbox.state !== "started") {
      await sandbox.start(120)
    }

    const repoPath = `${PATHS.SANDBOX_HOME}/project`

    // ── Stage 3: file upload ───────────────────────────────────────────────
    let uploadedFilePaths: string[] = []
    if (files.length > 0) {
      try {
        uploadedFilePaths = await uploadFilesToSandbox(sandbox, repoPath, files)
      } catch (err) {
        // Match the legacy behavior: file-upload errors don't abort the
        // send. The agent simply runs without seeing the files.
        console.error("[chats/messages] file upload failed:", err)
      }
    }

    // Build the prompt the agent sees. Mirrors the legacy client logic.
    let agentPrompt = payload.message
    if (uploadedFilePaths.length > 0) {
      agentPrompt +=
        "\n\n---\nUploaded files:\n" +
        uploadedFilePaths.map((p) => `- ${p}`).join("\n")
    }

    // ── Stage 4: spin up the background session (does NOT start the agent yet) ──
    const env = getEnvForModel(payload.model, payload.agent as Agent, credentials)
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern: previewUrlPattern ?? undefined,
      sessionId: chat.sessionId ?? undefined,
      agent: payload.agent as Agent,
      model: payload.model,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    // ── Stage 5: persist messages + chat status (transactional) ────────────
    const now = Date.now()
    await prisma.$transaction(async (tx) => {
      // Reject reuse of a message ID that already exists in a different
      // chat — the upsert below would otherwise overwrite a foreign row.
      const existing = await tx.message.findMany({
        where: { id: { in: [payload.userMessageId, payload.assistantMessageId] } },
        select: { id: true, chatId: true },
      })
      for (const m of existing) {
        if (m.chatId !== chatId) {
          throw new Error("Message ID belongs to a different chat")
        }
      }

      await tx.message.upsert({
        where: { id: payload.userMessageId },
        create: {
          id: payload.userMessageId,
          chatId,
          role: "user",
          content: agentPrompt,
          timestamp: BigInt(now),
          uploadedFiles:
            uploadedFilePaths.length > 0
              ? (uploadedFilePaths as unknown as Prisma.InputJsonValue)
              : undefined,
        },
        update: {
          content: agentPrompt,
          uploadedFiles:
            uploadedFilePaths.length > 0
              ? (uploadedFilePaths as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      })

      await tx.message.upsert({
        where: { id: payload.assistantMessageId },
        create: {
          id: payload.assistantMessageId,
          chatId,
          role: "assistant",
          content: "",
          timestamp: BigInt(now + 1),
          toolCalls: [],
          contentBlocks: [],
        },
        update: {},
      })

      await tx.chat.update({
        where: { id: chatId },
        data: {
          status: "running",
          backgroundSessionId: bgSession.backgroundSessionId,
          lastActiveAt: new Date(),
          // Persist agent/model so subsequent messages on this chat keep them
          agent: payload.agent,
          model: payload.model,
        },
      })
    })

    // ── Stage 6: kick off the agent ────────────────────────────────────────
    await bgSession.start(agentPrompt)

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
    if (createdSandbox && sandboxId) {
      await deleteSandboxQuietly(daytona, sandboxId)
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
