import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { randomUUID } from "crypto"
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
import { createAgentSession, getProviderEnv, validateCredentials } from "@/lib/agent-service"
import { AGENT_PROVIDER, isAgentProvider } from "@/lib/constants"
import type { ProviderName } from "@/lib/types"

export const maxDuration = 60 // Only needs to start the background process

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId, agent, model, sessionId } = body

  if (!sandboxId || !prompt || !messageId) {
    return badRequest("Missing required fields")
  }

  // Validate and set provider
  const provider: ProviderName = isAgentProvider(agent) ? agent : AGENT_PROVIDER.CLAUDE

  // 2. Verify sandbox belongs to this user
  const sandboxRecord = await getSandboxWithAuth(sandboxId, auth.userId)
  if (!sandboxRecord) {
    return notFound("Sandbox not found")
  }

  // 3. Get credentials
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Decrypt user's credentials
  const credentials = decryptUserCredentials(sandboxRecord.user.credentials)

  // Validate credentials for the selected provider/model
  const validation = validateCredentials(provider, model, credentials)
  if (!validation.valid) {
    return badRequest(`Missing credentials: ${validation.missing.join(", ")}`)
  }

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `/home/daytona/${actualRepoName}`

  try {
    // 4. Ensure sandbox is ready
    const { sandbox, resumeSessionId } = await ensureSandboxReady(
      daytonaApiKey,
      sandboxId,
      actualRepoName,
      previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      credentials.anthropicApiKey,
      credentials.anthropicAuthType,
      credentials.anthropicAuthToken,
    )

    // 5. Generate unique execution ID
    const executionId = randomUUID()
    const outputFile = `/tmp/agent_output_${executionId}.jsonl`

    // 6. Verify message exists before creating AgentExecution (prevents FK constraint violation)
    const messageRecord = await prisma.message.findUnique({
      where: { id: messageId },
    })
    if (!messageRecord) {
      return notFound("Message not found - it may not have been saved yet")
    }

    // 7. Create AgentExecution record
    await prisma.agentExecution.create({
      data: {
        messageId,
        sandboxId,
        executionId,
        status: "running",
      },
    })

    // 8. Update sandbox and branch status
    await updateSandboxAndBranchStatus(
      sandboxRecord.id,
      sandboxRecord.branch?.id,
      "running",
      { lastActiveAt: new Date() }
    )

    // 9. Build environment variables for the provider
    const env = getProviderEnv(provider, credentials, model)
    env.REPO_PATH = repoPath
    if (previewUrlPattern || sandboxRecord.previewUrlPattern) {
      env.PREVIEW_URL_PATTERN = previewUrlPattern || sandboxRecord.previewUrlPattern || ""
    }

    // Use session ID from request or from previous sandbox session
    const activeSessionId = sessionId || resumeSessionId || undefined

    // 10. Create background session using SDK
    const session = await createAgentSession({
      provider,
      sandbox,
      model,
      sessionId: activeSessionId,
      env,
      outputFile,
      timeout: 600000, // 10 minutes
    })

    // 11. Start the agent
    const startResult = await session.start(prompt)

    // 12. Reset auto-stop timer
    try {
      await sandbox.refreshActivity()
    } catch {
      // Non-critical
    }

    return Response.json({
      success: true,
      executionId,
      messageId,
      outputFile,
      cursor: startResult.cursor,
      provider,
      pid: startResult.pid,
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
