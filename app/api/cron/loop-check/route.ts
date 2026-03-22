import { prisma } from "@/lib/prisma"
import { EXECUTION_STATUS } from "@/lib/constants"
import { processAgentCompletion } from "@/lib/agent-completion"

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
    const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000)

    const executions = await prisma.agentExecution.findMany({
      where: {
        status: EXECUTION_STATUS.COMPLETED,
        completionHandledAt: null,
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
              },
            },
          },
        },
      },
      take: 10, // Process up to 10 at a time to avoid timeout
    })

    console.log(`[cron/loop-check] Found ${executions.length} completed executions to check`)

    let continued = 0

    for (const execution of executions) {
      try {
        const result = await processAgentCompletion({
          branchId: execution.message.branchId,
          executionId: execution.id,
          status: "completed",
          content: execution.message.content,
          source: "cron",
        })
        if (result.handled && result.loopContinued) {
          continued++
        }
      } catch (error) {
        console.error(`[cron/loop-check] Error processing execution ${execution.id}:`, error)
      }
    }

    console.log(`[cron/loop-check] Done. Continued ${continued}`)

    return Response.json({
      success: true,
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
