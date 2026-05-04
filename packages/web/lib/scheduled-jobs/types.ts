import type { ScheduledJob as PrismaScheduledJob, ScheduledJobRun as PrismaScheduledJobRun } from "@prisma/client"

// =============================================================================
// Shared types for scheduled jobs
// =============================================================================

/**
 * Subset of run fields included in lastRun
 */
export interface ScheduledJobLastRun {
  id: string
  status: string
  startedAt: number
  completedAt: number | null
  prUrl: string | null
  prNumber: number | null
  error: string | null
}

/**
 * API response type for a scheduled job run
 */
export interface ScheduledJobRun {
  id: string
  status: string
  startedAt: number
  completedAt: number | null
  branch: string | null
  commitCount: number
  prUrl: string | null
  prNumber: number | null
  error: string | null
  chatId: string | null
}

/**
 * API response type for a scheduled job
 */
export interface ScheduledJob {
  id: string
  name: string
  prompt: string
  repo: string
  baseBranch: string
  agent: string
  model: string | null
  intervalMinutes: number
  enabled: boolean
  nextRunAt: number
  autoPR: boolean
  consecutiveFailures: number
  createdAt: number
  updatedAt: number
  lastRun: ScheduledJobLastRun | null
}

// =============================================================================
// Conversion helpers (Prisma -> API response)
// =============================================================================

/**
 * Convert a Prisma ScheduledJobRun to API response format
 */
export function toScheduledJobRunResponse(run: PrismaScheduledJobRun): ScheduledJobRun {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.getTime(),
    completedAt: run.completedAt?.getTime() ?? null,
    branch: run.branch,
    commitCount: run.commitCount,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    error: run.error,
    chatId: run.chatId,
  }
}

/**
 * Convert a Prisma ScheduledJobRun to lastRun format (subset of fields)
 */
export function toLastRunResponse(run: PrismaScheduledJobRun): ScheduledJobLastRun {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.getTime(),
    completedAt: run.completedAt?.getTime() ?? null,
    prUrl: run.prUrl,
    prNumber: run.prNumber,
    error: run.error,
  }
}

/**
 * Convert a Prisma ScheduledJob (with optional runs) to API response format
 */
export function toScheduledJobResponse(
  job: PrismaScheduledJob & { runs?: PrismaScheduledJobRun[] }
): ScheduledJob {
  const lastRun = job.runs?.[0]
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt,
    repo: job.repo,
    baseBranch: job.baseBranch,
    agent: job.agent,
    model: job.model,
    intervalMinutes: job.intervalMinutes,
    enabled: job.enabled,
    nextRunAt: job.nextRunAt.getTime(),
    autoPR: job.autoPR,
    consecutiveFailures: job.consecutiveFailures,
    createdAt: job.createdAt.getTime(),
    updatedAt: job.updatedAt.getTime(),
    lastRun: lastRun ? toLastRunResponse(lastRun) : null,
  }
}

// =============================================================================
// Formatting helpers
// =============================================================================

/**
 * Format interval in minutes to human-readable string
 */
export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}
