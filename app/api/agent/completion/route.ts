import { unauthorized, requireCompletionAuth, isAuthError, badRequest } from "@/lib/api-helpers"
import { processAgentCompletion } from "@/lib/agent-completion"
import { prisma } from "@/lib/prisma"
import { INCLUDE_EXECUTION_WITH_CONTEXT } from "@/lib/prisma-includes"

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = await requireCompletionAuth(req)
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const {
    branchId,
    executionId,
    status,
    content,
    source,
    stopped,
  } = body as {
    branchId?: string
    executionId?: string
    status?: "completed" | "error"
    content?: string
    source?: "client" | "cron"
    stopped?: boolean
  }

  if (!branchId || !executionId || !status || !source) {
    return badRequest("Missing required fields")
  }

  const execution = await prisma.agentExecution.findFirst({
    where: {
      OR: [
        { id: executionId },
        { executionId },
      ],
    },
    include: INCLUDE_EXECUTION_WITH_CONTEXT,
  })

  if (!execution) {
    return Response.json({ error: "Execution not found" }, { status: 404 })
  }

  if (execution.message.branchId !== branchId) {
    return badRequest("Execution does not belong to the provided branch")
  }

  if (!auth.isCron && execution.message.branch.repo.userId !== auth.userId) {
    return unauthorized()
  }

  const result = await processAgentCompletion({
    branchId,
    executionId,
    status,
    content,
    source,
    stopped,
  })

  return Response.json(result)
}
