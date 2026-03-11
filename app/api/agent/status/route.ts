import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Daytona } from "@daytonaio/sdk"
import { getOutputFilePath } from "@/lib/background-agent-script"

export async function POST(req: Request) {
  // 1. Authenticate
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { executionId, messageId } = body

  if (!executionId && !messageId) {
    return Response.json({ error: "Missing executionId or messageId" }, { status: 400 })
  }

  // 2. Find the execution record
  const execution = await prisma.agentExecution.findFirst({
    where: executionId
      ? { executionId }
      : { messageId },
    include: {
      message: {
        include: {
          branch: {
            include: {
              sandbox: true,
            },
          },
        },
      },
    },
  })

  if (!execution) {
    return Response.json({ error: "Execution not found" }, { status: 404 })
  }

  // 3. Verify user owns this execution
  const sandbox = execution.message.branch.sandbox
  if (!sandbox || sandbox.userId !== session.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 })
  }

  // 4. Get credentials
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 })
  }

  try {
    // 5. Read output file from sandbox
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

    const outputFile = getOutputFilePath(execution.executionId)
    const result = await sandboxInstance.process.executeCommand(
      `cat "${outputFile}" 2>/dev/null || echo '{"status":"pending"}'`
    )

    let outputData: {
      status: string
      content: string
      toolCalls: Array<{ tool: string; summary: string }>
      contentBlocks: Array<{ type: string; text?: string; toolCalls?: Array<{ tool: string; summary: string }> }>
      error: string | null
      sessionId: string | null
    }

    try {
      outputData = JSON.parse(result.result.trim())
    } catch {
      // File doesn't exist yet or invalid JSON
      return Response.json({
        status: "running",
        content: "",
        toolCalls: [],
        error: null,
      })
    }

    // 6. Only update DB on completion/error (not on every poll)
    // This reduces DB operations from 6 per poll to 1 read + batch write on completion
    const isCompleted = outputData.status === "completed" || outputData.status === "error"

    if (isCompleted) {
      // Batch all updates in a single transaction
      await prisma.$transaction([
        // Update message content
        prisma.message.update({
          where: { id: execution.messageId },
          data: {
            content: outputData.content || "",
            toolCalls: outputData.toolCalls && outputData.toolCalls.length > 0
              ? outputData.toolCalls
              : undefined,
            contentBlocks: outputData.contentBlocks && outputData.contentBlocks.length > 0
              ? outputData.contentBlocks
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
            ...(outputData.sessionId && { sessionId: outputData.sessionId }),
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
    return Response.json({
      status: "error",
      error: message,
      content: "",
      toolCalls: [],
    })
  }
}

// Also support GET for simpler polling
export async function GET(req: Request) {
  const url = new URL(req.url)
  const executionId = url.searchParams.get("executionId")
  const messageId = url.searchParams.get("messageId")

  if (!executionId && !messageId) {
    return Response.json({ error: "Missing executionId or messageId" }, { status: 400 })
  }

  // Create a fake request body and delegate to POST
  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ executionId, messageId }),
  })

  return POST(fakeReq)
}
