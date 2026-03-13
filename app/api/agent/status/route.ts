import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import { pollBackgroundAgent } from "@/lib/agent-session"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  decryptUserCredentials,
  badRequest,
  notFound,
  unauthorized,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { executionId, messageId } = body

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  // 2. Find the execution record with user credentials for env
  const execution = await prisma.agentExecution.findFirst({
    where: executionId ? { executionId } : { messageId },
    include: {
      message: {
        include: {
          branch: {
            include: {
              sandbox: {
                include: {
                  user: {
                    include: {
                      credentials: true,
                    },
                  },
                },
              },
              repo: true,
            },
          },
        },
      },
    },
  })

  if (!execution) {
    console.warn("[agent/status] execution not found", {
      executionId,
      messageId,
    })
    return notFound("Execution not found")
  }

  // 3. Verify user owns this execution
  const sandbox = execution.message.branch.sandbox
  if (!sandbox || sandbox.userId !== auth.userId) {
    return unauthorized()
  }

  // 4. Get credentials
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  try {
    // 5. Get sandbox instance
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandboxInstance = await daytona.get(execution.sandboxId)

    // Check if sandbox is running
    if (sandboxInstance.state !== "started") {
      // Sandbox stopped - mark execution as error if still running
      if (execution.status === "running") {
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: "error", completedAt: new Date() },
        })
        await prisma.branch.update({
          where: { id: execution.message.branchId },
          data: { status: "idle" },
        })
        return Response.json({
          status: "error",
          error: "Sandbox stopped unexpectedly",
          content: execution.message.content,
          toolCalls: execution.message.toolCalls,
        })
      }
    }

    // 6. Build poll options (SDK needs session config to reattach to background session)
    const repoName = execution.message.branch.repo?.name || "repo"
    const repoPath = `/home/daytona/${repoName}`
    const previewUrlPattern = sandbox.previewUrlPattern || undefined

    // Decrypt user credentials for env vars
    const { anthropicApiKey } =
      decryptUserCredentials(sandbox.user.credentials)
    const env: Record<string, string> = {}
    if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey

    // Poll via SDK helper with full options.
    // For new executions, the long-lived background session ID is stored on the sandbox.
    // For older executions, fall back to using execution.executionId directly.
    const backgroundSessionId =
      sandbox.sessionId || execution.executionId

    const outputData = await pollBackgroundAgent(
      sandboxInstance,
      backgroundSessionId,
      { repoPath, previewUrlPattern, env }
    )

    // 7. Only update DB on completion/error (not on every poll)
    const isCompleted =
      outputData.status === "completed" || outputData.status === "error"

    if (isCompleted) {
      // Batch all updates in a single transaction
      await prisma.$transaction([
        // Update message content
        prisma.message.update({
          where: { id: execution.messageId },
          data: {
            content: outputData.content || "",
            toolCalls:
              outputData.toolCalls && outputData.toolCalls.length > 0
                ? outputData.toolCalls
                : undefined,
            contentBlocks:
              outputData.contentBlocks && outputData.contentBlocks.length > 0
                ? JSON.parse(JSON.stringify(outputData.contentBlocks))
                : undefined,
          },
        }),
        // Update execution status
        prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: outputData.status,
            completedAt: new Date(),
          },
        }),
        // Update sandbox (status + sessionId)
        prisma.sandbox.update({
          where: { id: sandbox.id },
          data: {
            status: "idle",
          },
        }),
        // Update branch status
        prisma.branch.update({
          where: { id: execution.message.branchId },
          data: { status: "idle" },
        }),
      ])

      // Refresh sandbox activity on completion
      try {
        await sandboxInstance.refreshActivity()
      } catch {
        // Non-critical
      }
    }

    return Response.json({
      status: outputData.status,
      content: outputData.content || "",
      toolCalls: outputData.toolCalls || [],
      contentBlocks: outputData.contentBlocks || [],
      error: outputData.error,
      sessionId: outputData.sessionId,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[agent/status] error:", message)
    // Return error but don't clear content - let client handle gracefully
    // The polling will retry and may recover
    return Response.json({
      status: "error",
      error: message,
      content: "",
      toolCalls: [],
      contentBlocks: [],
    })
  }
}

// Also support GET for simpler polling
export async function GET(req: Request) {
  const url = new URL(req.url)
  const executionId = url.searchParams.get("executionId")
  const messageId = url.searchParams.get("messageId")

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  // Create a fake request body and delegate to POST
  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ executionId, messageId }),
  })

  return POST(fakeReq)
}
