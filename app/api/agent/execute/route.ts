import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { startBackgroundAgent } from "@/lib/agent-session"
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

export const maxDuration = 60 // Only needs to start the background process

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId } = body

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

  // Decrypt user's Anthropic credentials
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } =
    decryptUserCredentials(sandboxRecord.user.credentials)

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `/home/daytona/${actualRepoName}`

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
      sandboxRecord.sessionId || undefined // Pass database session ID for resumption
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
      }
    )

    // 7. Create AgentExecution record with SDK's execution ID
    await prisma.agentExecution.create({
      data: {
        messageId,
        sandboxId,
        // Use SDK's executionId as the unique DB identifier
        executionId,
        status: "running",
      },
    })

    // Persist the background session ID on the sandbox so future runs can reuse it
    if (sandboxRecord.sessionId !== backgroundSessionId) {
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { sessionId: backgroundSessionId },
      })
    }

    // 8. Update sandbox and branch status
    await updateSandboxAndBranchStatus(
      sandboxRecord.id,
      sandboxRecord.branch?.id,
      "running",
      { lastActiveAt: new Date() }
    )

    // 9. Reset auto-stop timer
    try {
      await sandbox.refreshActivity()
    } catch {
      // Non-critical
    }

    return Response.json({
      success: true,
      // Return the unique AgentExecution.executionId so polling can look it up.
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
