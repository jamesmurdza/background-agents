import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  unauthorized,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
  decryptUserCredentials,
} from "@/lib/api-helpers"
import { INCLUDE_EXECUTION_WITH_CONTEXT } from "@/lib/prisma-includes"
import { PATHS, SNAPSHOT_POLL_THROTTLE_MS } from "@/lib/constants"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { pollBackgroundAgent } from "@/lib/agent-session"
import { updateSnapshot } from "@/lib/agent-events"
import { persistExecutionCompletion } from "@/lib/agent-events"
import type { Agent } from "@/lib/types"

function buildSnapshotResponse(
  execution: { status: string; message: { content?: string; toolCalls?: unknown[]; contentBlocks?: unknown[] } },
  snapshot: Record<string, unknown>
) {
  return Response.json({
    status: execution.status,
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

  // Status-driven polling (serverless): when execution is running, poll sandbox from this request
  // so events reach the frontend even when the execute handler's background poller never runs.
  // Use an atomic claim (update lastSnapshotPolledAt) so only one concurrent request does the heavy poll;
  // others skip and refetch, avoiding duplicate logs and duplicate message updates.
  const execWithPolledAt = execution as typeof execution & { lastSnapshotPolledAt?: Date | null }
  if (execution.status === "running") {
    const now = Date.now()
    const lastPolled = execWithPolledAt.lastSnapshotPolledAt?.getTime() ?? 0
    const shouldPoll = now - lastPolled >= SNAPSHOT_POLL_THROTTLE_MS

    let claimed = false
    if (shouldPoll) {
      const claimCutoff = new Date(now - SNAPSHOT_POLL_THROTTLE_MS)
      const result = await prisma.$executeRaw`
        UPDATE "AgentExecution"
        SET "lastSnapshotPolledAt" = ${new Date()}
        WHERE id = ${execution.id}
          AND ("lastSnapshotPolledAt" IS NULL OR "lastSnapshotPolledAt" < ${claimCutoff})
      `
      claimed = Number(result) > 0
    }

    if (shouldPoll && claimed) {
      const daytonaApiKey = getDaytonaApiKey()
      if (!isDaytonaKeyError(daytonaApiKey)) {
        const sandboxRecord = await getSandboxWithAuth(execution.sandboxId, auth.userId)
        if (sandboxRecord) {
          const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, opencodeApiKey } =
            decryptUserCredentials(sandboxRecord.user.credentials)
          const actualRepoName = execution.message.branch.repo?.name ?? "repo"
          const repoPath = `${PATHS.SANDBOX_HOME}/${actualRepoName}`
          const backgroundSessionId = sandboxRecord.sessionId

          if (backgroundSessionId) {
            try {
              const branch = execution.message.branch as { previewUrlPattern?: string | null; model?: string | null; agent?: string | null }
              const agent = branch.agent as Agent | undefined
              // Use same canonical Daytona sandbox ID as execute (sandboxRecord.sandboxId) so we read the same meta.json
              const daytonaSandboxId = sandboxRecord.sandboxId
              const { sandbox, env } = await ensureSandboxReady(
                daytonaApiKey,
                daytonaSandboxId,
                actualRepoName,
                branch.previewUrlPattern ?? sandboxRecord.previewUrlPattern ?? undefined,
                anthropicApiKey,
                anthropicAuthType,
                anthropicAuthToken,
                sandboxRecord.sessionId ?? undefined,
                sandboxRecord.sessionAgent ?? undefined,
                openaiApiKey,
                agent,
                branch.model ?? undefined,
                opencodeApiKey
              )

              const result = await pollBackgroundAgent(sandbox, backgroundSessionId, {
                agentExecutionId: execution.id,
                repoPath,
                previewUrlPattern: branch.previewUrlPattern ?? sandboxRecord.previewUrlPattern ?? undefined,
                model: branch.model ?? undefined,
                env,
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
  }

  const snapshot = ((execution as { latestSnapshot?: unknown }).latestSnapshot as Record<string, unknown> | null) ?? {}
  return buildSnapshotResponse(
    execution as { status: string; message: { content?: string; toolCalls?: unknown[]; contentBlocks?: unknown[] } },
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
