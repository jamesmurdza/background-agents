import { prisma } from "@/lib/db/prisma"
import { ensureSandboxReady, SandboxNotFoundError } from "@/lib/sandbox/sandbox-resume"
import { createBackgroundAgentSession } from "@/lib/agents/agent-session"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
  resolveUserCredentials,
  badRequest,
  notFound,
  internalError,
  updateSandboxAndBranchStatus,
  resetSandboxStatus,
  getGitHubTokenForUser,
} from "@/lib/shared/api-helpers"
import { PATHS } from "@/lib/shared/constants"
import type { Agent } from "@/lib/shared/types"
import { logActivity } from "@/lib/shared/activity-log"

// Agent execution timeout - 60 seconds (must be literal for Next.js static analysis)
export const maxDuration = 60

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId, agent: bodyAgent, model: bodyModel } = body

  if (!sandboxId || !prompt || !messageId) {
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

  // Resolve user's credentials (uses team owner's Claude subscription if member)
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, opencodeApiKey } =
    await resolveUserCredentials(sandboxRecord.user.credentials, auth.userId)

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `${PATHS.SANDBOX_HOME}/${actualRepoName}`

  // Use agent/model from request body (current UI selection) when valid; else DB; ensures run matches what user selected
  const validAgents: Agent[] = ["claude-code", "opencode", "codex"]
  const agent = validAgents.includes(bodyAgent) ? bodyAgent : (sandboxRecord.branch?.agent as Agent) || "claude-code"
  const model = bodyModel ?? sandboxRecord.branch?.model ?? undefined

  // Persist agent/model to branch when we used body values so DB stays in sync
  const branchId = sandboxRecord.branch?.id
  if (branchId && (agent !== (sandboxRecord.branch?.agent as Agent) || model !== sandboxRecord.branch?.model)) {
    await prisma.branch.update({
      where: { id: branchId },
      data: { agent, ...(model !== undefined && { model }) },
    })
  }

  // 4. Verify message exists before creating AgentExecution (prevents FK constraint violation)
  const messageRecord = await prisma.message.findUnique({
    where: { id: messageId },
  })
  if (!messageRecord) {
    return notFound("Message not found - it may not have been saved yet")
  }

  // Canonical Daytona sandbox ID from DB — use this for session and execution so status reads the same meta
  const daytonaSandboxId = sandboxRecord.sandboxId

  try {
    // 5. Ensure sandbox is ready and create background session (fast — no sandbox process launched yet)
    let t0 = Date.now()
    const { sandbox, resumeSessionId, env } = await ensureSandboxReady(
      daytonaApiKey,
      daytonaSandboxId,
      actualRepoName,
      previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      anthropicApiKey,
      anthropicAuthType,
      anthropicAuthToken,
      sandboxRecord.sessionId || undefined,
      sandboxRecord.sessionAgent || undefined,
      openaiApiKey,
      agent,
      model,
      opencodeApiKey,
      sandboxRecord.branch?.repo?.id // Pass repoId for MCP config
    )
    console.log(`[agent/execute] ensureSandboxReady took ${Date.now() - t0}ms`)

    // 5a. If branch needs sync (e.g., was merge target), pull latest before agent starts
    if (branchId && sandboxRecord.branch?.needsSync) {
      t0 = Date.now()
      const githubToken = await getGitHubTokenForUser(auth.userId)
      if (githubToken) {
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubToken)
          console.log(`[agent/execute] needsSync pull took ${Date.now() - t0}ms`)
        } catch (err) {
          // Log but don't fail - the merge succeeded, pull failure is non-fatal
          console.warn(`[agent/execute] needsSync pull failed:`, err)
        }
      }
      // Clear the flag regardless of pull success (avoid infinite retry)
      await prisma.branch.update({
        where: { id: branchId },
        data: { needsSync: false },
      })
    }

    t0 = Date.now()
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern:
        previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      sessionId: resumeSessionId,
      agent,
      model,
      // Note: env is passed at start() time for freshest credentials
    })
    console.log(`[agent/execute] createBackgroundAgentSession took ${Date.now() - t0}ms`)

    // 6. Persist session ID so polling can find it, create execution record
    const { backgroundSessionId } = bgSession
    if (sandboxRecord.sessionId !== backgroundSessionId || sandboxRecord.sessionAgent !== agent) {
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { sessionId: backgroundSessionId, sessionAgent: agent },
      })
    }

    const agentExecution = await prisma.agentExecution.create({
      data: {
        messageId,
        sandboxId: daytonaSandboxId,
        status: "running",
      },
    })

    // 7. Update sandbox and branch status
    await updateSandboxAndBranchStatus(
      sandboxRecord.id,
      sandboxRecord.branch?.id,
      "running",
      { lastActiveAt: new Date() }
    )

    // 8. Start the turn and write meta before returning (so client polling sees runId/outputFile)
    // Pass env at start() time for freshest credentials (run-level overrides session-level)
    try {
      await bgSession.start(prompt, { env })
    } catch (error) {
      console.error("[agent/execute] bgSession.start failed", { messageId }, error)
      try {
        const errMsg = error instanceof Error ? error.message : "Unknown error"
        await prisma.$transaction([
          prisma.agentExecution.update({
            where: { id: agentExecution.id },
            data: { status: "error", completedAt: new Date() },
          }),
          prisma.message.update({
            where: { id: messageId },
            data: { content: `Error starting agent: ${errMsg}` },
          }),
        ])
      } catch {
        // Ignore
      }
      await resetSandboxStatus(sandboxRecord.id, sandboxRecord.branch?.id)
      return internalError(error)
    }

    try {
      await sandbox.refreshActivity()
    } catch {
      // Non-critical
    }

    // Log activity for metrics
    logActivity(auth.userId, "agent_executed", {
      sandboxId: daytonaSandboxId,
      repoOwner: sandboxRecord.branch?.repo?.owner,
      repoName: actualRepoName,
      branchName: sandboxRecord.branch?.name,
      agent,
      model,
    })

    return Response.json({ success: true, messageId, executionId: agentExecution.id })
  } catch (error: unknown) {
    // Handle sandbox not found - tell frontend to recreate
    if (error instanceof SandboxNotFoundError) {
      // Clean up the stale sandbox record from DB
      await prisma.sandbox.delete({ where: { id: sandboxRecord.id } }).catch(() => {})

      // Return info needed for frontend to recreate
      // Only branchId is needed - the create endpoint will fetch branch details
      return Response.json(
        {
          error: "SANDBOX_NOT_FOUND",
          message: "Sandbox was deleted and needs to be recreated",
          recreateInfo: {
            branchId: sandboxRecord.branch?.id,
          },
        },
        { status: 410 } // 410 Gone - resource no longer available
      )
    }

    // Other errors - sandbox not ready, session creation failed
    await resetSandboxStatus(sandboxRecord.id, sandboxRecord.branch?.id)
    return internalError(error)
  }
}
