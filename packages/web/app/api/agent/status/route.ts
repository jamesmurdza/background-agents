import { prisma } from "@/lib/db/prisma"
import { Daytona } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  unauthorized,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
} from "@/lib/shared/api-helpers"
import { INCLUDE_EXECUTION_WITH_CONTEXT } from "@/lib/db/prisma-includes"
import { PATHS, SNAPSHOT_POLL_THROTTLE_MS } from "@/lib/shared/constants"
import { pollBackgroundAgent } from "@/lib/agents/agent-session"
import { updateSnapshot } from "@/lib/agents/agent-events"
import { persistExecutionCompletion } from "@/lib/agents/agent-events"
import type { Agent } from "@/lib/shared/types"

// Serverless single-writer lease window for status-driven polling.
// Only one request can claim heavy polling work for an execution during this window;
// all other concurrent requests are read-only snapshot fetches.
const STATUS_POLL_LEASE_MS = 5000

function buildSnapshotResponse(
  execution: { status: string; snapshotVersion: number; message: { content?: string; toolCalls?: unknown[]; contentBlocks?: unknown[] } },
  snapshot: Record<string, unknown>
) {
  return Response.json({
    status: execution.status,
    snapshotVersion: execution.snapshotVersion,
    content: snapshot.content ?? execution.message.content ?? "",
    toolCalls: snapshot.toolCalls ?? execution.message.toolCalls ?? [],
    contentBlocks: snapshot.contentBlocks ?? execution.message.contentBlocks ?? [],
    error: undefined,
    agentCrashed:
      snapshot.agentCrashed && typeof snapshot.agentCrashed === "object"
        ? (snapshot.agentCrashed as { message?: string; output?: string })
        : undefined,
  })
}

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { executionId, messageId } = body as {
    executionId?: string
    messageId?: string
  }

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  // Look up the execution and its message/branch context.
  let execution = await prisma.agentExecution.findFirst({
    where: executionId ? { executionId } : { messageId },
    include: INCLUDE_EXECUTION_WITH_CONTEXT,
  })

  if (!execution) {
    return notFound("Execution not found")
  }

  // Verify the authenticated user owns this repo.
  const repo = execution.message.branch.repo
  if (!repo || repo.userId !== auth.userId) {
    return unauthorized()
  }

  // Status-driven polling (serverless): use DB lease claim so exactly one request
  // per execution does heavy poll work; all others return read-only snapshots.
  if (execution.status === "running") {
    let claimed = false
    const now = Date.now()
    const leaseWindowMs = Math.max(STATUS_POLL_LEASE_MS, SNAPSHOT_POLL_THROTTLE_MS)
    const claimCutoff = new Date(now - leaseWindowMs)
    const result = await prisma.$executeRaw`
      UPDATE "AgentExecution"
      SET "lastSnapshotPolledAt" = ${new Date()}
      WHERE id = ${execution.id}
        AND ("lastSnapshotPolledAt" IS NULL OR "lastSnapshotPolledAt" < ${claimCutoff})
    `
    claimed = Number(result) > 0

    if (claimed) {
      const daytonaApiKey = getDaytonaApiKey()
      if (!isDaytonaKeyError(daytonaApiKey)) {
        const sandboxRecord = await getSandboxWithAuth(execution.sandboxId, auth.userId)
        if (sandboxRecord) {
          const actualRepoName = execution.message.branch.repo?.name ?? "repo"
          const repoPath = `${PATHS.SANDBOX_HOME}/${actualRepoName}`
          const backgroundSessionId = sandboxRecord.sessionId

          if (backgroundSessionId) {
            try {
              const branch = execution.message.branch as { previewUrlPattern?: string | null; model?: string | null; agent?: string | null }
              const agent = branch.agent as Agent | undefined
              // Status polling should be read-mostly; avoid ensureSandboxReady here.
              // We only need a sandbox handle to read background session events.
              const daytonaSandboxId = sandboxRecord.sandboxId
              const daytona = new Daytona({ apiKey: daytonaApiKey })
              const sandbox = await daytona.get(daytonaSandboxId)

              const result = await pollBackgroundAgent(sandbox, backgroundSessionId, {
                agentExecutionId: execution.id,
                repoPath,
                previewUrlPattern: branch.previewUrlPattern ?? sandboxRecord.previewUrlPattern ?? undefined,
                model: branch.model ?? undefined,
                agent,
              })

              if (result.status === "completed" || result.status === "error") {
                const execWithMessage = await prisma.agentExecution.findUnique({
                  where: { id: execution.id },
                  include: { message: true },
                })
                if (execWithMessage) {
                  await persistExecutionCompletion(execWithMessage, result)
                }
              } else {
                await updateSnapshot(execution.id, { lastSnapshotPolledAt: new Date() })
              }
            } catch (err) {
              console.error("[agent/status] status-driven poll failed", { executionId: execution.id }, err)
            }
          }
        }
      }
    }
    // Re-fetch so response uses latest snapshot (from us or another concurrent request)
    const refetched = await prisma.agentExecution.findFirst({
      where: { id: execution.id },
      include: INCLUDE_EXECUTION_WITH_CONTEXT,
    })
    if (refetched) execution = refetched
  } else if (execution.status === "completed" || execution.status === "error") {
    // For completed/error status, always refetch to ensure we have the final message content.
    // This avoids a race condition where the initial load might have stale content
    // if persistExecutionCompletion was called by another request concurrently.
    const refetched = await prisma.agentExecution.findFirst({
      where: { id: execution.id },
      include: INCLUDE_EXECUTION_WITH_CONTEXT,
    })
    if (refetched) execution = refetched
  }

  const snapshot = ((execution as { latestSnapshot?: unknown }).latestSnapshot as Record<string, unknown> | null) ?? {}
  return buildSnapshotResponse(
    execution as { status: string; snapshotVersion: number; message: { content?: string; toolCalls?: unknown[]; contentBlocks?: unknown[] } },
    snapshot
  )
}

// Optional GET variant for convenience
export async function GET(req: Request) {
  const url = new URL(req.url)
  const executionId = url.searchParams.get("executionId") || undefined
  const messageId = url.searchParams.get("messageId") || undefined

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ executionId, messageId }),
  })

  return POST(fakeReq)
}
