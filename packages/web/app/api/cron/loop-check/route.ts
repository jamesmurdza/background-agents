import { prisma } from "@/lib/db/prisma"
import { ensureSandboxReady } from "@/lib/sandbox/sandbox-resume"
import { createBackgroundAgentSession } from "@/lib/agents/agent-session"
import {
  getDaytonaApiKey,
  isDaytonaKeyError,
  resolveUserCredentials,
  updateSandboxAndBranchStatus,
} from "@/lib/shared/api-helpers"
import { PATHS, EXECUTION_STATUS } from "@/lib/shared/constants"
import { isLoopFinished, LOOP_CONTINUATION_MESSAGE } from "@/lib/shared/types"
import type { Agent } from "@/lib/shared/types"

// Cron job timeout - allow up to 60 seconds
export const maxDuration = 60

// Verify cron secret to prevent unauthorized access
function verifyCronSecret(req: Request): boolean {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.warn("[cron/loop-check] CRON_SECRET not configured")
    return false
  }

  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(req: Request) {
  // Verify this is a legitimate cron request
  if (!verifyCronSecret(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/loop-check] Starting loop check...")

  try {
    // Find all completed executions where:
    // - Execution completed successfully
    // - Branch has loopEnabled = true
    // - loopCount < loopMaxIterations
    // - Response does not indicate FINISHED
    // - Completed more than 15 seconds ago (to let frontend handle first)
    const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000)

    const executions = await prisma.agentExecution.findMany({
      where: {
        status: EXECUTION_STATUS.COMPLETED,
        completedAt: {
          lt: fifteenSecondsAgo,
        },
        message: {
          branch: {
            loopEnabled: true,
            status: "idle", // Only process if branch is idle (not already running)
          },
        },
      },
      include: {
        message: {
          include: {
            branch: {
              include: {
                repo: true,
                sandbox: {
                  include: {
                    user: {
                      include: {
                        credentials: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      take: 10, // Process up to 10 at a time to avoid timeout
    })

    console.log(`[cron/loop-check] Found ${executions.length} completed executions to check`)

    let processed = 0
    let continued = 0

    for (const execution of executions) {
      const branch = execution.message.branch
      const sandbox = branch.sandbox

      if (!sandbox) {
        console.log(`[cron/loop-check] No sandbox for branch ${branch.id}, skipping`)
        continue
      }

      // Check if loop should continue
      const content = execution.message.content
      const loopCount = branch.loopCount || 0
      const loopMaxIterations = branch.loopMaxIterations || 10

      if (loopCount >= loopMaxIterations) {
        console.log(`[cron/loop-check] Branch ${branch.id} reached max iterations (${loopCount}/${loopMaxIterations})`)
        // Reset loop count and disable loop
        await prisma.branch.update({
          where: { id: branch.id },
          data: { loopCount: 0 },
        })
        continue
      }

      if (isLoopFinished(content)) {
        console.log(`[cron/loop-check] Branch ${branch.id} agent indicated FINISHED`)
        // Reset loop count
        await prisma.branch.update({
          where: { id: branch.id },
          data: { loopCount: 0 },
        })
        continue
      }

      processed++

      // Trigger loop continuation
      console.log(`[cron/loop-check] Continuing loop for branch ${branch.id} (${loopCount + 1}/${loopMaxIterations})`)

      try {
        // Get API keys
        const daytonaApiKey = getDaytonaApiKey()
        if (isDaytonaKeyError(daytonaApiKey)) {
          console.error(`[cron/loop-check] No Daytona API key for branch ${branch.id}`)
          continue
        }

        const { anthropicApiKey, anthropicAuthToken, anthropicAuthType, openaiApiKey, opencodeApiKey } =
          await resolveUserCredentials(sandbox.user.credentials, sandbox.userId)

        const agent = (branch.agent as Agent) || "claude-code"
        const model = branch.model || undefined
        const repoName = branch.repo.name
        const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

        // Create the continuation message
        const newMessage = await prisma.message.create({
          data: {
            branchId: branch.id,
            role: "user",
            content: LOOP_CONTINUATION_MESSAGE,
          },
        })

        // Create assistant placeholder message
        const assistantMessage = await prisma.message.create({
          data: {
            branchId: branch.id,
            role: "assistant",
            content: "",
            assistantSource: "model",
          },
        })

        // Update branch status and increment loop count
        await prisma.branch.update({
          where: { id: branch.id },
          data: {
            status: "running",
            loopCount: loopCount + 1,
          },
        })

        // Ensure sandbox is ready and create session
        const { sandbox: daytonaSandbox, resumeSessionId, env } = await ensureSandboxReady(
          daytonaApiKey,
          sandbox.sandboxId,
          repoName,
          sandbox.previewUrlPattern || undefined,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken,
          sandbox.sessionId || undefined,
          sandbox.sessionAgent || undefined,
          openaiApiKey,
          agent,
          model,
          opencodeApiKey,
          branch.repo.id // Pass repoId for MCP config
        )

        const bgSession = await createBackgroundAgentSession(daytonaSandbox, {
          repoPath,
          previewUrlPattern: sandbox.previewUrlPattern || undefined,
          sessionId: resumeSessionId,
          agent,
          model,
          // Note: env is passed at start() time for freshest credentials
        })

        // Persist session ID
        if (sandbox.sessionId !== bgSession.backgroundSessionId || sandbox.sessionAgent !== agent) {
          await prisma.sandbox.update({
            where: { id: sandbox.id },
            data: { sessionId: bgSession.backgroundSessionId, sessionAgent: agent },
          })
        }

        // Create execution record
        await prisma.agentExecution.create({
          data: {
            messageId: assistantMessage.id,
            sandboxId: sandbox.sandboxId,
            status: "running",
            isLoopIteration: true,
          },
        })

        // Update sandbox status
        await updateSandboxAndBranchStatus(
          sandbox.id,
          branch.id,
          "running",
          { lastActiveAt: new Date() }
        )

        // Start the agent with fresh env (run-level overrides session-level)
        await bgSession.start(LOOP_CONTINUATION_MESSAGE, { env })

        continued++
        console.log(`[cron/loop-check] Successfully continued loop for branch ${branch.id}`)
      } catch (error) {
        console.error(`[cron/loop-check] Error continuing loop for branch ${branch.id}:`, error)
        // Reset branch status on error
        await prisma.branch.update({
          where: { id: branch.id },
          data: { status: "idle" },
        })
      }
    }

    console.log(`[cron/loop-check] Done. Processed ${processed}, continued ${continued}`)

    return Response.json({
      success: true,
      processed,
      continued,
    })
  } catch (error) {
    console.error("[cron/loop-check] Error:", error)
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
