import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"

/**
 * Fetch a scheduled job by id and verify it belongs to `userId`.
 *
 * Pass the same `select`/`include` you would give
 * `prisma.scheduledJob.findUnique` to shape the returned row. The query must
 * resolve the job's `userId` (either implicitly — the default row — or via an
 * explicit `select` that includes it) so ownership can be checked.
 *
 * Returns the job on success, or `null` when it doesn't exist or is owned by
 * someone else. Routes should map `null` to a 404 that doesn't distinguish the
 * two cases, so job ids aren't probeable.
 */
export async function getScheduledJobWithAuth<
  T extends Omit<Prisma.ScheduledJobFindUniqueArgs, "where">,
>(
  jobId: string,
  userId: string,
  args?: T,
): Promise<Prisma.ScheduledJobGetPayload<T> | null> {
  const job = await prisma.scheduledJob.findUnique({
    where: { id: jobId },
    ...args,
  })
  if (!job || (job as { userId: string }).userId !== userId) return null
  return job as Prisma.ScheduledJobGetPayload<T>
}
