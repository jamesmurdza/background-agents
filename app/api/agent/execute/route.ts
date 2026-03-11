import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/encryption"
import { ensureSandboxReady } from "@/lib/sandbox-resume"
import { getBackgroundAgentScript, getOutputFilePath } from "@/lib/background-agent-script"
import { randomUUID } from "crypto"

export const maxDuration = 60 // Only needs to start the background process

export async function POST(req: Request) {
  // 1. Authenticate
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId } = body

  if (!sandboxId || !prompt || !messageId) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // 2. Verify sandbox belongs to this user
  const sandboxRecord = await prisma.sandbox.findUnique({
    where: { sandboxId },
    include: {
      user: { include: { credentials: true } },
      branch: { include: { repo: true } },
    },
  })

  if (!sandboxRecord || sandboxRecord.userId !== session.user.id) {
    return Response.json({ error: "Sandbox not found" }, { status: 404 })
  }

  // 3. Get credentials
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 })
  }

  // Decrypt user's Anthropic credentials
  const creds = sandboxRecord.user.credentials
  let anthropicApiKey: string | undefined
  let anthropicAuthToken: string | undefined
  const anthropicAuthType = creds?.anthropicAuthType || "api-key"

  if (creds?.anthropicApiKey) {
    anthropicApiKey = decrypt(creds.anthropicApiKey)
  }
  if (creds?.anthropicAuthToken) {
    anthropicAuthToken = decrypt(creds.anthropicAuthToken)
  }

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
      return Response.json({ error: "Message not found - it may not have been saved yet" }, { status: 404 })
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
    await prisma.sandbox.update({
      where: { id: sandboxRecord.id },
      data: { lastActiveAt: new Date(), status: "running" },
    })
    if (sandboxRecord.branch) {
      await prisma.branch.update({
        where: { id: sandboxRecord.branch.id },
        data: { status: "running" },
      })
    }

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
    const message = error instanceof Error ? error.message : "Unknown error"

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
    await prisma.sandbox.update({
      where: { id: sandboxRecord.id },
      data: { status: "idle" },
    })
    if (sandboxRecord.branch) {
      await prisma.branch.update({
        where: { id: sandboxRecord.branch.id },
        data: { status: "idle" },
      })
    }

    return Response.json({ error: message }, { status: 500 })
  }
}
