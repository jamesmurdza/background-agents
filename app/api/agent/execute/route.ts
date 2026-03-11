import { prisma } from "@/lib/prisma"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { getBackgroundAgentScript, getOutputFilePath } from "@/lib/background-agent-script"
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
  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } = decryptUserCredentials(
    sandboxRecord.user.credentials
  )

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"
  const repoPath = `/home/daytona/${actualRepoName}`

  try {
    // 4. Ensure sandbox is ready
    const { sandbox, wasResumed, resumeSessionId } = await ensureSandboxReady(
      daytonaApiKey,
      sandboxId,
      actualRepoName,
      previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
      anthropicApiKey,
      anthropicAuthType,
      anthropicAuthToken,
    )

    // Update context if it was recreated
    if (wasResumed) {
      // Context was recreated, but we don't need it for background execution
    }

    // 5. Generate unique execution ID
    const executionId = randomUUID()

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

    // 9. Upload background agent script
    const scriptContent = getBackgroundAgentScript(executionId)
    const scriptB64 = Buffer.from(scriptContent).toString("base64")
    await sandbox.process.executeCommand(
      `echo '${scriptB64}' | base64 -d > /tmp/bg_agent_${executionId}.py`
    )

    // 10. Build environment variables
    const envVars: string[] = [
      `REPO_PATH="${repoPath}"`,
      `MESSAGE_ID="${messageId}"`,
      `PROMPT="${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    ]

    if (previewUrlPattern || sandboxRecord.previewUrlPattern) {
      envVars.push(`PREVIEW_URL_PATTERN="${previewUrlPattern || sandboxRecord.previewUrlPattern}"`)
    }
    if (resumeSessionId) {
      envVars.push(`RESUME_SESSION_ID="${resumeSessionId}"`)
    }
    if (anthropicAuthType !== "claude-max" && anthropicApiKey) {
      envVars.push(`ANTHROPIC_API_KEY="${anthropicApiKey}"`)
    }

    // 11. Start background process using nohup
    const envString = envVars.join(" ")
    const command = `cd ${repoPath} && ${envString} nohup python3 /tmp/bg_agent_${executionId}.py > /tmp/agent_log_${executionId}.txt 2>&1 &`

    await sandbox.process.executeCommand(command)

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
      outputFile: getOutputFilePath(executionId),
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
