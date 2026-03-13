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

export const maxDuration = 300 // 5 minute timeout for agent queries

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

  // Decrypt user's Anthropic credentials
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } =
    decryptUserCredentials(sandboxRecord.user.credentials)

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `/home/daytona/${actualRepoName}`

  const encoder = new TextEncoder()

  // Capture record IDs for use in helper functions
  const sandboxDbId = sandboxRecord.id
  const branchDbId = sandboxRecord.branch?.id

  // Accumulate output so we can save it to DB even if client disconnects
  let accumulatedContent = ""
  let accumulatedToolCalls: { tool: string; summary: string }[] = []
  let streamCancelled = false
  let hasSavedToDb = false

  // Helper to save accumulated content to DB (idempotent)
  async function saveAccumulatedContent() {
    if (hasSavedToDb) return
    if (!messageId) return
    if (!accumulatedContent && accumulatedToolCalls.length === 0) return

    hasSavedToDb = true
    try {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          content: accumulatedContent,
          toolCalls:
            accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        },
      })
    } catch {
      // Message may not exist if client disconnected before it was saved
    }

    // Also update branch/sandbox status to idle when cancelled
    if (streamCancelled) {
      try {
        await resetSandboxStatus(sandboxDbId, branchDbId)
      } catch {
        // Non-critical
      }
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Safe send that doesn't throw if stream is cancelled
      function send(data: Record<string, unknown>) {
        if (streamCancelled) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller is closed/cancelled, ignore the error
          streamCancelled = true
        }
      }

      try {
        // Ensure sandbox is ready (handles auth, CLI installation)
        const { sandbox, resumeSessionId, env } = await ensureSandboxReady(
          daytonaApiKey,
          sandboxId,
          actualRepoName,
          previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken
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
          if (streamCancelled) break

          switch (event.type) {
            case "token":
              accumulatedContent += event.content || ""
              send({ type: "stdout", content: event.content })
              break

            case "tool":
              if (event.toolCall) {
                accumulatedToolCalls.push(event.toolCall)
                send({
                  type: "stdout",
                  content: `TOOL_USE:${event.toolCall.summary}\n`,
                })
              }
              break

            case "session":
              if (event.sessionId) {
                send({ type: "session-id", sessionId: event.sessionId })
                prisma.sandbox
                  .update({
                    where: { id: sandboxRecord.id },
                    data: { sessionId: event.sessionId },
                  })
                  .catch(() => {})
              }
              break

            case "error":
              send({ type: "error", message: event.message })
              break
          }
        }

        // Save accumulated output to database
        await saveAccumulatedContent()

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

        send({ type: "done" })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"

        // Save error message to database if we have a messageId
        // Only add error to content if it's not a stream cancellation
        if (!streamCancelled) {
          const errorMsg = `Error: ${message}`
          accumulatedContent = accumulatedContent
            ? `${accumulatedContent}\n\n${errorMsg}`
            : errorMsg
        }
        await saveAccumulatedContent()

        send({ type: "error", message })
      }

      controller.close()
    },
    cancel() {
      // Called when the client disconnects (e.g., page refresh)
      streamCancelled = true
      // Save whatever we have accumulated so far
      // This runs async but we don't need to wait for it
      saveAccumulatedContent()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
