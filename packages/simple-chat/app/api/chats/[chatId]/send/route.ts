import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireGitHubAuth,
  isGitHubAuthError,
  requireAuth,
  isAuthError,
  getChatWithAuth,
  getUserCredentials,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { createBackgroundAgentSession } from "@/lib/agent-session"
import { getEnvForModel } from "@upstream/common"
import { generateBranchName } from "@/lib/utils"

export const maxDuration = 300 // 5 minutes

// =============================================================================
// Types
// =============================================================================

interface SendMessageBody {
  content: string
  agent?: string
  model?: string
  uploadedFiles?: string[]
}

interface MessageResponse {
  id: string
  role: string
  content: string
  timestamp: number
  messageType: string | null
  isError: boolean
  toolCalls: unknown
  contentBlocks: unknown
  uploadedFiles: unknown
  linkBranch: string | null
}

// =============================================================================
// POST - Send message (creates user message, assistant placeholder, starts agent)
// =============================================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const { chatId } = await params

  // Check if this is a GitHub repo chat - if so, need GitHub auth
  // First do basic auth check
  const basicAuth = await requireAuth()
  if (isAuthError(basicAuth)) return basicAuth
  const { userId } = basicAuth

  try {
    const body: SendMessageBody = await req.json()

    if (!body.content) {
      return badRequest("content is required")
    }

    // Get the chat
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    const isNewRepo = chat.repo === NEW_REPOSITORY || chat.repo === "__new__"

    // For GitHub repos, we need the GitHub token
    let githubToken: string | undefined
    if (!isNewRepo) {
      const ghAuth = await requireGitHubAuth()
      if (isGitHubAuthError(ghAuth)) return ghAuth
      githubToken = ghAuth.token
    }

    // Get user credentials
    const credentials = await getUserCredentials(userId)

    // Get Daytona API key
    const daytonaApiKey = process.env.DAYTONA_API_KEY
    if (!daytonaApiKey) {
      return Response.json(
        { error: "Daytona API key not configured" },
        { status: 500 }
      )
    }

    const now = Date.now()
    const selectedAgent = body.agent || chat.agent
    const selectedModel = body.model || chat.model

    // Create both messages in a transaction
    const [userMessage, assistantMessage] = await prisma.$transaction(
      async (tx) => {
        const userMsg = await tx.message.create({
          data: {
            chatId,
            role: "user",
            content: body.content,
            timestamp: BigInt(now),
            uploadedFiles: body.uploadedFiles,
          },
        })

        const assistantMsg = await tx.message.create({
          data: {
            chatId,
            role: "assistant",
            content: "",
            timestamp: BigInt(now + 1), // Ensure ordering
            toolCalls: [],
            contentBlocks: [],
          },
        })

        return [userMsg, assistantMsg]
      }
    )

    // Create sandbox if needed
    let sandboxId = chat.sandboxId
    let branch = chat.branch
    let previewUrlPattern = chat.previewUrlPattern
    let sessionId = chat.sessionId

    const daytona = new Daytona({ apiKey: daytonaApiKey })

    if (!sandboxId) {
      // Generate branch name
      branch = `agent/${generateBranchName()}`

      // Create sandbox
      const sandbox = await daytona.create({
        snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
        autoStopInterval: 10,
        public: true,
        labels: {
          [SANDBOX_CONFIG.LABEL_KEY]: "true",
          repo: isNewRepo ? NEW_REPOSITORY : chat.repo,
          branch,
        },
      })

      sandboxId = sandbox.id

      // Set up logs directory
      await sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

      // Set up repository
      const repoPath = `${PATHS.SANDBOX_HOME}/project`

      if (isNewRepo) {
        await sandbox.process.executeCommand(`mkdir -p ${repoPath}`)
        await sandbox.process.executeCommand(`cd ${repoPath} && git init`)
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git config user.email "agent@simplechat.dev" && git config user.name "Simple Chat Agent"`
        )
        await sandbox.process.executeCommand(
          `cd ${repoPath} && echo "# Project" > README.md && git add . && git commit -m "Initial commit"`
        )
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git checkout -b ${branch}`
        )
      } else {
        // Clone GitHub repo
        const [owner, repoApiName] = chat.repo.split("/")
        const cloneUrl = `https://github.com/${owner}/${repoApiName}.git`

        await sandbox.git.clone(
          cloneUrl,
          repoPath,
          chat.baseBranch,
          undefined,
          "x-access-token",
          githubToken!
        )

        // Set up git author
        let gitName = "Simple Chat Agent"
        let gitEmail = "noreply@example.com"
        try {
          const ghRes = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
            },
          })
          if (ghRes.ok) {
            const ghUser = await ghRes.json()
            gitName = ghUser.name || ghUser.login
            gitEmail = `${ghUser.login}@users.noreply.github.com`
          }
        } catch {
          // Use defaults
        }
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git config user.email "${gitEmail}" && git config user.name "${gitName}"`
        )

        // Create branch
        await sandbox.git.createBranch(repoPath, branch!)
        await sandbox.git.checkoutBranch(repoPath, branch!)
      }

      // Get preview URL pattern
      try {
        const previewLink = await sandbox.getPreviewLink(
          SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT
        )
        previewUrlPattern = previewLink.url.replace(
          String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT),
          "{port}"
        )
      } catch {
        // Preview URLs not available
      }

      // Update chat with sandbox info
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

    // Get sandbox and ensure it's running
    let sandbox
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found" },
        { status: 410 }
      )
    }

    if (sandbox.state !== "started") {
      await sandbox.start(120)
    }

    // Pull if needsSync
    let synced = false
    if (chat.needsSync && githubToken && branch) {
      try {
        const repoPath = `${PATHS.SANDBOX_HOME}/project`
        const pullResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git pull origin ${branch} 2>&1`
        )
        if (pullResult.exitCode === 0) {
          synced = true
        }
      } catch {
        // Best effort
      }
    }

    // Build env vars for agent
    const env = getEnvForModel(selectedModel || undefined, selectedAgent, {
      anthropicApiKey: credentials.anthropicApiKey,
      anthropicAuthToken: credentials.anthropicAuthToken,
      openaiApiKey: credentials.openaiApiKey,
      opencodeApiKey: credentials.opencodeApiKey,
      geminiApiKey: credentials.geminiApiKey,
    })

    // Build prompt with uploaded files if any
    let agentPrompt = body.content
    if (body.uploadedFiles && body.uploadedFiles.length > 0) {
      agentPrompt +=
        "\n\n---\nUploaded files:\n" +
        body.uploadedFiles.map((p) => `- ${p}`).join("\n")
    }

    // Create background agent session
    const repoPath = `${PATHS.SANDBOX_HOME}/project`
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern: previewUrlPattern || undefined,
      sessionId: sessionId || undefined,
      agent: selectedAgent,
      model: selectedModel || undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    // Start the agent
    await bgSession.start(agentPrompt)

    // Update chat with running state
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        status: "running",
        backgroundSessionId: bgSession.backgroundSessionId,
        lastActiveAt: new Date(),
        ...(synced && { needsSync: false }),
      },
    })

    // Format response
    const formatMessage = (m: typeof userMessage): MessageResponse => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: Number(m.timestamp),
      messageType: m.messageType,
      isError: m.isError,
      toolCalls: m.toolCalls,
      contentBlocks: m.contentBlocks,
      uploadedFiles: m.uploadedFiles,
      linkBranch: m.linkBranch,
    })

    return Response.json({
      userMessage: formatMessage(userMessage),
      assistantMessage: formatMessage(assistantMessage),
      backgroundSessionId: bgSession.backgroundSessionId,
      sandboxId,
      branch,
      previewUrlPattern,
      synced,
    })
  } catch (error) {
    console.error("[chats/send] Error:", error)
    return internalError(error)
  }
}
