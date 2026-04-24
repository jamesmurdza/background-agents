import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { getEnvForModel } from "@upstream/common"
import { prisma } from "@/lib/db/prisma"
import { getUserCredentials } from "@/lib/db/api-helpers"

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const {
    sandboxId,
    sessionId,
    prompt,
    repoName,
    previewUrlPattern,
    agent,
    model,
    chatId,
    userMessageId,
    assistantMessageId,
  } = body

  if (!sandboxId || !prompt || !repoName) {
    return Response.json(
      { error: "Missing required fields: sandboxId, prompt, repoName" },
      { status: 400 }
    )
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  const session = await getServerSession(authOptions)
  const githubToken = session?.accessToken
  const userId = session?.user?.id

  try {
    // Get user credentials if authenticated
    const credentials = userId ? await getUserCredentials(userId) : {}

    // Get sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox

    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found" },
        { status: 410 }
      )
    }

    // Start sandbox if not running
    if (sandbox.state !== "started") {
      await sandbox.start(120)
    }

    // Pull if chat needs sync
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
    let synced = false
    if (chatId && githubToken) {
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { needsSync: true, branch: true },
      })
      if (chat?.needsSync && chat.branch) {
        try {
          const pullResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git pull origin ${chat.branch} 2>&1`
          )
          if (pullResult.exitCode === 0) {
            synced = true
          }
        } catch {
          // Best effort
        }
      }
    }

    // Build env vars
    const env = getEnvForModel(model, agent || "opencode", credentials)

    // Create background agent session
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern,
      sessionId: sessionId || undefined,
      agent: agent || "opencode",
      model,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    // IMPORTANT: Persist messages to database BEFORE starting the agent
    // This prevents race conditions where the stream route tries to update
    // messages that don't exist yet
    if (chatId && userId && userMessageId && assistantMessageId) {
      const now = Date.now()
      try {
        await prisma.$transaction(async (tx) => {
          // Create user message
          await tx.message.upsert({
            where: { id: userMessageId },
            create: {
              id: userMessageId,
              chatId,
              role: "user",
              content: prompt,
              timestamp: BigInt(now),
            },
            update: {
              content: prompt,
            },
          })

          // Create assistant placeholder
          await tx.message.upsert({
            where: { id: assistantMessageId },
            create: {
              id: assistantMessageId,
              chatId,
              role: "assistant",
              content: "",
              timestamp: BigInt(now + 1),
              toolCalls: [],
              contentBlocks: [],
            },
            update: {},
          })

          // Update chat status with backgroundSessionId
          await tx.chat.update({
            where: { id: chatId },
            data: {
              status: "running",
              backgroundSessionId: bgSession.backgroundSessionId,
              lastActiveAt: new Date(),
              ...(synced && { needsSync: false }),
            },
          })
        })
      } catch (error) {
        console.error("[agent/start] Failed to persist to DB:", error)
        // Continue anyway - streaming will try to persist
      }
    }

    // Start the agent AFTER messages are persisted to DB
    await bgSession.start(prompt)

    return Response.json({
      backgroundSessionId: bgSession.backgroundSessionId,
      status: "running",
      synced,
    })
  } catch (error) {
    console.error("[agent/start] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
