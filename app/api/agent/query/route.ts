import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
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
  const { sandboxId, contextId, prompt, previewUrlPattern, repoName, messageId } = body

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
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } = decryptUserCredentials(
    sandboxRecord.user.credentials
  )

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"

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
          toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
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
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // Controller is closed/cancelled, ignore the error
          streamCancelled = true
        }
      }

      try {
        // Use resume helper to ensure sandbox + agent are ready
        const { sandbox, contextId: activeContextId, wasResumed, resumeSessionId } = await ensureSandboxReady(
          daytonaApiKey,
          sandboxId,
          actualRepoName,
          previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken,
        )

        // If context was re-created after resume, notify frontend and update DB
        if (wasResumed) {
          send({ type: "context-updated", contextId: activeContextId })
          await prisma.sandbox.update({
            where: { id: sandboxRecord.id },
            data: { contextId: activeContextId },
          })
        }

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

        // Find the context to use
        const contexts = await sandbox.codeInterpreter.listContexts()
        const ctx = contexts.find((c) => c.id === activeContextId)
        if (!ctx) {
          throw new Error(
            "Agent context not found. The sandbox may have been reset. Please create a new branch."
          )
        }

        // Run the query with streaming output
        const result = await sandbox.codeInterpreter.runCode(
          `coding_agent.run_query_sync(os.environ.get('PROMPT', ''))`,
          {
            context: ctx,
            envs: {
              PROMPT: prompt,
              ...(previewUrlPattern || sandboxRecord.previewUrlPattern
                ? { PREVIEW_URL_PATTERN: previewUrlPattern || sandboxRecord.previewUrlPattern }
                : {}),
              ...(resumeSessionId ? { RESUME_SESSION_ID: resumeSessionId } : {}),
            },
            onStdout: (msg) => {
              const text = msg.output
              // Parse SESSION_ID: prefix from agent stdout
              if (text.startsWith("SESSION_ID:")) {
                const sessionId = text.replace("SESSION_ID:", "").trim()
                if (sessionId) {
                  send({ type: "session-id", sessionId })
                  // Update session ID in database
                  prisma.sandbox.update({
                    where: { id: sandboxRecord.id },
                    data: { sessionId },
                  }).catch(() => {})
                }
                return
              }
              // Accumulate output for server-side persistence
              if (text.startsWith("TOOL_USE:")) {
                const toolSummary = text.replace("TOOL_USE:", "").trim()
                const toolName = toolSummary.split(":")[0].trim()
                accumulatedToolCalls.push({ tool: toolName, summary: toolSummary })
              } else {
                accumulatedContent += text
              }
              send({ type: "stdout", content: text })
            },
            onStderr: (msg) => {
              send({ type: "stderr", content: msg.output })
            },
          }
        )

        if (result.error) {
          const errorMsg = `Error: ${result.error.value}`
          accumulatedContent = accumulatedContent
            ? `${accumulatedContent}\n\n${errorMsg}`
            : errorMsg
          send({ type: "error", message: result.error.value })
        }

        // Save accumulated output to database - ensures message is persisted even if client disconnects
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
