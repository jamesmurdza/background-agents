import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { createAgentSession, runAgentQuery } from "@/lib/agent-session"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
  decryptUserCredentials,
  badRequest,
  notFound,
  resetSandboxStatus,
} from "@/lib/api-helpers"
import {
  createSSEStream,
  sendError,
  createContentAccumulator,
} from "@/lib/streaming-helpers"
import { PATHS } from "@/lib/constants"

// Agent query timeout - 300 seconds (must be literal for Next.js static analysis)
export const maxDuration = 300

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId } = body

  if (!sandboxId || !prompt) {
    return badRequest("Missing required fields")
  }

  // 2. Verify sandbox belongs to this user
  const sandboxRecord = await getSandboxWithAuth(sandboxId, auth.userId)
  if (!sandboxRecord) {
    return notFound("Sandbox not found")
  }

  // 3. Get credentials
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Decrypt user's credentials (Anthropic, OpenAI, and OpenCode)
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, opencodeApiKey } =
    decryptUserCredentials(sandboxRecord.user.credentials)

  // Get agent and model from branch for API key selection
  const agent = sandboxRecord.branch?.agent as "claude-code" | "opencode" | undefined
  const model = sandboxRecord.branch?.model || undefined

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `${PATHS.SANDBOX_HOME}/${actualRepoName}`

  // Capture record IDs for use in helper functions
  const sandboxDbId = sandboxRecord.id
  const branchDbId = sandboxRecord.branch?.id

  // Create accumulator for tracking streamed content
  const accumulator = createContentAccumulator()
  let hasSavedToDb = false

  // Helper to save accumulated content to DB (idempotent)
  async function saveAccumulatedContent(cancelled: boolean) {
    if (hasSavedToDb) return
    if (!messageId) return
    const content = accumulator.getContent()
    const toolCalls = accumulator.getToolCalls()
    if (!content && toolCalls.length === 0) return

    hasSavedToDb = true
    try {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
      })
    } catch {
      // Message may not exist if client disconnected before it was saved
    }

    // Also update branch/sandbox status to idle when cancelled
    if (cancelled) {
      try {
        await resetSandboxStatus(sandboxDbId, branchDbId)
      } catch {
        // Non-critical
      }
    }
  }

  return createSSEStream({
    onStart: async (controller) => {
      try {
        // Ensure sandbox is ready (handles auth, CLI installation)
        const { sandbox, resumeSessionId, env } = await ensureSandboxReady(
          daytonaApiKey,
          sandboxId,
          actualRepoName,
          previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken,
          sandboxRecord.sessionId || undefined, // Pass database session ID for resumption
          sandboxRecord.sessionAgent || undefined, // when different from current agent, we start a new session
          openaiApiKey,
          agent,
          model,
          opencodeApiKey
        )

        // Update last activity
        await prisma.sandbox.update({
          where: { id: sandboxRecord.id },
          data: { lastActiveAt: new Date(), status: "running" },
        })

        // Reset auto-stop timer
        try {
          await sandbox.refreshActivity()
        } catch {
          // Non-critical
        }

        // Create SDK session and run query
        const { session } = await createAgentSession(sandbox, {
          repoPath,
          previewUrlPattern:
            previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
          sessionId: resumeSessionId,
          env,
        })

        // Stream events
        for await (const event of runAgentQuery(session, sandbox, prompt)) {
          if (controller.isCancelled()) break

          switch (event.type) {
            case "token":
              accumulator.addContent(event.content || "")
              controller.send({ type: "stdout", content: event.content })
              break

            case "tool":
              if (event.toolCall) {
                accumulator.addToolCall(event.toolCall)
                controller.send({
                  type: "stdout",
                  content: `TOOL_USE:${event.toolCall.summary}\n`,
                })
              }
              break

            case "session":
              if (event.sessionId) {
                controller.send({ type: "session-id", sessionId: event.sessionId })
                prisma.sandbox
                  .update({
                    where: { id: sandboxRecord.id },
                    data: { sessionId: event.sessionId, sessionAgent: agent },
                  })
                  .catch(() => {})
              }
              break

            case "error":
              controller.send({ type: "error", message: event.message })
              break
          }
        }

        // Save accumulated output to database
        await saveAccumulatedContent(false)

        // Update sandbox and branch status back to idle
        await prisma.sandbox.update({
          where: { id: sandboxRecord.id },
          data: { status: "idle" },
        })
        if (sandboxRecord.branch) {
          await prisma.branch.update({
            where: { id: sandboxRecord.branch.id },
            data: { status: "idle" },
          })
        }

        controller.send({ type: "done" })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"

        // Save error message to database if we have a messageId
        // Only add error to content if it's not a stream cancellation
        if (!controller.isCancelled()) {
          accumulator.addError(message)
        }
        await saveAccumulatedContent(controller.isCancelled())

        sendError(controller, message)
      }
    },
    onCancel: () => {
      // Save whatever we have accumulated so far
      saveAccumulatedContent(true)
    },
  })
}
