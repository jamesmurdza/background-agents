import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { BackgroundPollResult } from "@/lib/agent-session"

/** Execution with message - for persistExecutionCompletion */
type ExecutionWithMessage = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.agentExecution.findUnique<{ where: { id: string }; include: { message: true } }>
    >
  >
>

/**
 * Persist completion/error state to DB (message, execution, sandbox, branch).
 */
export async function persistExecutionCompletion(
  execution: NonNullable<ExecutionWithMessage>,
  result: BackgroundPollResult
): Promise<void> {
  let content = result.content || ""
  if (result.status === "error" && result.agentCrashed) {
    const { message, output } = result.agentCrashed
    const crashMsg = message ?? "Process exited without completing"
    content = content ? `${content}\n\n[Agent crashed: ${crashMsg}]` : `[Agent crashed: ${crashMsg}]`
    if (output) content += `\n\nOutput:\n${output}`
  } else if (result.status === "error" && result.error) {
    content = content ? `${content}\n\n[Agent stopped: ${result.error}]` : `[Agent stopped: ${result.error}]`
  }

  const updates = [
    prisma.message.update({
      where: { id: execution.messageId },
      data: {
        content,
        toolCalls:
          result.toolCalls?.length ? result.toolCalls : undefined,
        contentBlocks:
          result.contentBlocks?.length ? JSON.parse(JSON.stringify(result.contentBlocks)) : undefined,
      },
    }),
    prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: result.status,
        completedAt: new Date(),
        latestSnapshot:
          result.agentCrashed != null
            ? (result.agentCrashed as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        accumulatedEvents: Prisma.DbNull,
        lastSnapshotPolledAt: null,
      },
    }),
    prisma.sandbox.updateMany({
      where: { id: execution.sandboxId },
      data: { status: "idle" },
    }),
  ]
  const tx = execution.message?.branchId
    ? [
        ...updates,
        prisma.branch.updateMany({
          where: { id: execution.message.branchId },
          data: { status: "idle" },
        }),
      ]
    : updates
  await prisma.$transaction(tx)
}

export interface SnapshotData {
  content?: string
  toolCalls?: unknown[]
  contentBlocks?: unknown[]
}

export interface SnapshotUpdate {
  latestSnapshot?: SnapshotData
  accumulatedEvents?: unknown[]
  lastSnapshotPolledAt?: Date
}

/**
 * Write the latest streaming snapshot to the execution row.
 * Status API reads this until completion (then final content is on Message).
 */
export async function updateSnapshot(
  executionId: string,
  data: SnapshotData | SnapshotUpdate
): Promise<void> {
  const update: Record<string, unknown> = {}
  const withSnapshot =
    "latestSnapshot" in data && data.latestSnapshot != null
      ? data.latestSnapshot
      : "content" in data
        ? (data as SnapshotData)
        : null
  if (withSnapshot) update.latestSnapshot = withSnapshot
  if ("accumulatedEvents" in data && data.accumulatedEvents !== undefined) {
    update.accumulatedEvents = data.accumulatedEvents
  }
  if ("lastSnapshotPolledAt" in data && data.lastSnapshotPolledAt !== undefined) {
    update.lastSnapshotPolledAt = data.lastSnapshotPolledAt
  }
  await (prisma as any).agentExecution.update({
    where: { id: executionId },
    data: update,
  })
}

/** Load accumulated events for an execution (for status-driven polling across instances). */
export async function getAccumulatedEvents(executionId: string): Promise<unknown[]> {
  const row = await prisma.agentExecution.findUnique({
    where: { id: executionId },
    select: { accumulatedEvents: true },
  })
  const raw = row?.accumulatedEvents
  return Array.isArray(raw) ? raw : []
}
