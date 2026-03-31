import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError } from "@/lib/shared/api-helpers"

// Check for active (running) execution for a branch
// Used to resume polling after page refresh when messages haven't loaded yet
export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { branchId } = body

  if (!branchId) {
    return Response.json({ error: "Missing branchId" }, { status: 400 })
  }

  // Verify user owns this branch
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { repo: true },
  })

  if (!branch || branch.repo.userId !== auth.userId) {
    return Response.json({ error: "Branch not found" }, { status: 404 })
  }

  // Find the most recent execution for this branch (any status).
  // Returning completed/error executions allows the client to fetch
  // final content after a page refresh that races with completion.
  const execution = await prisma.agentExecution.findFirst({
    where: {
      message: { branchId },
    },
    orderBy: {
      startedAt: "desc",
    },
    select: {
      id: true,
      executionId: true,
      messageId: true,
      status: true,
      sandboxId: true,
      startedAt: true,
    },
  })

  if (!execution) {
    return Response.json({ execution: null })
  }

  return Response.json({
    execution: {
      id: execution.id,
      executionId: execution.executionId,
      messageId: execution.messageId,
      status: execution.status,
      sandboxId: execution.sandboxId,
      startedAt: execution.startedAt,
    },
  })
}

// Also support GET for easier debugging
export async function GET(req: Request) {
  const url = new URL(req.url)
  const branchId = url.searchParams.get("branchId")

  if (!branchId) {
    return Response.json({ error: "Missing branchId" }, { status: 400 })
  }

  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ branchId }),
  })

  return POST(fakeReq)
}
