import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { startBackgroundAgent } from "@/lib/agent-session"
import { startAgentPoller } from "@/lib/agent-poller"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
  decryptUserCredentials,
  badRequest,
  notFound,
  internalError,
  updateSandboxAndBranchStatus,
  resetSandboxStatus,
} from "@/lib/api-helpers"
import { PATHS } from "@/lib/constants"
import type { Agent } from "@/lib/types"

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

  // Decrypt user's credentials (Anthropic, OpenAI, and OpenRouter)
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, openrouterApiKey } =
    decryptUserCredentials(sandboxRecord.user.credentials)

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `${PATHS.SANDBOX_HOME}/${actualRepoName}`

  // Use agent/model from request body (current UI selection) when valid; else DB; ensures run matches what user selected
  const validAgents: Agent[] = ["claude-code", "opencode"]
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

  try {
    // 4. Ensure sandbox is ready
    const { sandbox, resumeSessionId, env } = await ensureSandboxReady(
      daytonaApiKey,
      sandboxId,
      actualRepoName,
      previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      anthropicApiKey,
      anthropicAuthType,
      anthropicAuthToken,
      sandboxRecord.sessionId || undefined, // Pass database session ID for resumption
      sandboxRecord.sessionAgent || undefined, // when different from current agent, we start a new session
      openaiApiKey,
      agent,
      model, // Pass model for API key selection
      openrouterApiKey
    )

    // 5. Verify message exists before creating AgentExecution (prevents FK constraint violation)
    const messageRecord = await prisma.message.findUnique({
      where: { id: messageId },
    })
    if (!messageRecord) {
      return notFound("Message not found - it may not have been saved yet")
    }

    // 6. Start background agent via SDK
    const { executionId, backgroundSessionId } = await startBackgroundAgent(
      sandbox,
      {
        prompt,
        repoPath,
        previewUrlPattern:
          previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
        // sessionId: resumeSessionId helps the provider reuse conversation state.
        // We intentionally do NOT reuse backgroundSessionId across executions,
        // so each run gets a fresh background session bound to the resumed conversation.
        sessionId: resumeSessionId,
        env,
        agent,
        model,
      }
    )

    // 7. Create AgentExecution record with SDK's execution ID
    const agentExecution = await prisma.agentExecution.create({
      data: {
        messageId,
        sandboxId,
        // Use SDK's executionId as the unique identifier for lookups from the client.
        executionId,
        status: "running",
      },
    })

    // Persist the background session ID and agent on the sandbox so future runs can reuse (same agent) or start fresh (agent changed)
    if (sandboxRecord.sessionId !== backgroundSessionId || sandboxRecord.sessionAgent !== agent) {
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { sessionId: backgroundSessionId, sessionAgent: agent },
      })
    }

    // 8. Start a single background poller for this execution.
    // This loop polls the Daytona background session and writes streaming
    // snapshots into execution.latestSnapshot for status API, then marks the execution
    // complete and updates message / branch / sandbox status.
    startAgentPoller({
      agentExecutionId: agentExecution.id,
      sandbox,
      backgroundSessionId,
      repoPath,
      previewUrlPattern:
        previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      model,
      env,
      agent,
    }).catch((error) => {
      console.error("[agent/execute] failed to start agent poller", {
        agentExecutionId: agentExecution.id,
      }, error)
    })

    // 9. Update sandbox and branch status
    await updateSandboxAndBranchStatus(
      sandboxRecord.id,
      sandboxRecord.branch?.id,
      "running",
      { lastActiveAt: new Date() }
    )

    // 10. Reset auto-stop timer
    try {
      await sandbox.refreshActivity()
    } catch {
      // Non-critical
    }

    return Response.json({
      success: true,
      // Return the SDK executionId for backwards compatibility; the SSE
      // endpoint maps this back to AgentExecution.id internally.
      executionId,
      messageId,
    })
  } catch (error: unknown) {
    // Update execution status to error if it was created
    try {
      const execution = await prisma.agentExecution.findFirst({
        where: { messageId },
      })
      if (execution) {
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: { status: "error", completedAt: new Date() },
        })
      }
    } catch {
      // Ignore
    }

    // Reset status
    await resetSandboxStatus(sandboxRecord.id, sandboxRecord.branch?.id)

    return internalError(error)
  }
}
