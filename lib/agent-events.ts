import { prisma } from "@/lib/prisma"

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
