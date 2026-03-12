import { prisma } from "@/lib/prisma"
import { Daytona } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  badRequest,
  notFound,
  unauthorized,
  internalError,
} from "@/lib/api-helpers"
import { createBackgroundSession } from "background-agents"
import { AGENT_PROVIDER, isAgentProvider, BRANCH_STATUS } from "@/lib/constants"
import type { ProviderName } from "@/lib/types"

export const maxDuration = 30

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { executionId, cursor, provider: requestProvider } = body

  if (!executionId) {
    return badRequest("Missing executionId")
  }

  // Validate provider
  const provider: ProviderName = isAgentProvider(requestProvider)
    ? requestProvider
    : AGENT_PROVIDER.CLAUDE

  // Find execution record
  const execution = await prisma.agentExecution.findFirst({
    where: { executionId },
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
    return notFound("Execution not found")
  }

  const sandbox = execution.message.branch.sandbox
  if (!sandbox || sandbox.userId !== auth.userId) {
    return unauthorized()
  }

  // Check if already completed
  if (execution.status === "completed") {
    return Response.json({
      status: "completed",
      events: [],
      cursor: cursor || "",
      sessionId: sandbox.sessionId,
    })
  }

  if (execution.status === "error") {
    return Response.json({
      status: "error",
      events: [],
      cursor: cursor || "",
      error: "Execution failed",
    })
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandboxInstance = await daytona.get(execution.sandboxId)

    // Use SDK to poll (it reads from outputFile)
    const outputFile = `/tmp/agent_output_${executionId}.jsonl`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await createBackgroundSession(provider, {
      sandbox: sandboxInstance as any,
      outputFile,
    })

    const result = await session.poll(cursor || undefined)

    // Update database on completion
    if (result.status === "completed") {
      await prisma.$transaction([
        prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: "completed", completedAt: new Date() },
        }),
        prisma.sandbox.update({
          where: { id: sandbox.id },
          data: {
            status: BRANCH_STATUS.IDLE,
            sessionId: result.sessionId || sandbox.sessionId,
          },
        }),
        prisma.branch.update({
          where: { id: execution.message.branchId },
          data: { status: BRANCH_STATUS.IDLE },
        }),
      ])
    }

    return Response.json({
      status: result.status,
      events: result.events,
      cursor: result.cursor,
      sessionId: result.sessionId,
    })

  } catch (error: unknown) {
    console.error("Poll error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({
      status: "error",
      error: message,
      events: [],
      cursor: cursor || "",
    })
  }
}
