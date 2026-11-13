/**
 * Server-side validation for client-requested *initial* sandbox resources
 * (RAM/disk picked before a sandbox exists, e.g. via the admin-only Sandbox
 * Resources modal on a draft chat). Mirrors the ceilings and admin gate
 * `app/api/sandbox/resize/route.ts` already enforces for resizing an
 * existing sandbox — never trust the client's numbers, re-check here too.
 */

import { prisma } from "@/lib/db/prisma"

/** Hard ceilings — must match app/api/sandbox/resize/route.ts. */
export const MAX_MEMORY_GB = 10
export const MAX_DISK_GB = 25

export interface RequestedResources {
  memory?: number
  disk?: number
}

/**
 * Validates and sanitizes client-requested initial sandbox resources.
 * Returns `undefined` (silently dropping the request rather than erroring —
 * this is a nice-to-have, not something that should block sandbox creation)
 * unless `userId` is an admin and at least one of memory/disk is a finite
 * number within range.
 */
export async function sanitizeInitialResources(
  userId: string,
  requested: RequestedResources | undefined
): Promise<RequestedResources | undefined> {
  if (!requested || (requested.memory == null && requested.disk == null)) return undefined

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })
  if (!user?.isAdmin) return undefined

  const result: RequestedResources = {}
  if (requested.memory != null) {
    const memoryGb = Number(requested.memory)
    if (Number.isFinite(memoryGb) && memoryGb >= 1 && memoryGb <= MAX_MEMORY_GB) {
      result.memory = memoryGb
    }
  }
  if (requested.disk != null) {
    const diskGb = Number(requested.disk)
    if (Number.isFinite(diskGb) && diskGb >= 1 && diskGb <= MAX_DISK_GB) {
      result.disk = diskGb
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}
