import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { createBackgroundAgentSession } from "@/lib/agent-session"
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
      openrouterApiKey
    )
    console.log(`[agent/execute] ensureSandboxReady took ${Date.now() - t0}ms`)

    t0 = Date.now()
    const bgSession = await createBackgroundAgentSession(sandbox, {
      repoPath,
      previewUrlPattern:
        previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      sessionId: resumeSessionId,
      env,
      agent,
      model,
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

    // 8. Return immediately — frontend can start polling by messageId
    const response = Response.json({ success: true, messageId })

    // 9. Fire-and-forget: launch the agent process (the slow part)
    bgSession.start(prompt).catch(async (error) => {
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
    })

    try {
      await sandbox.refreshActivity()
    } catch {
      // Non-critical
    }

    return response
  } catch (error: unknown) {
    // Sync steps failed (sandbox not ready, session creation failed)
    await resetSandboxStatus(sandboxRecord.id, sandboxRecord.branch?.id)
    return internalError(error)
  }
}
