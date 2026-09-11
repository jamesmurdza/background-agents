/**
 * Hourly sweep that refreshes Codex subscription credentials which have
 * reached their refresh window.
 *
 * Active users refresh on their own runs; this exists for dormant ones, whose
 * 10-day access token would otherwise expire unattended and turn their next
 * scheduled job into a failure.
 */
import { prisma } from "@/lib/db/prisma"
import { refreshCodexCredentialForUser } from "@/lib/server/codex-credentials"

export const maxDuration = 300

type RefreshOutcome = Awaited<ReturnType<typeof refreshCodexCredentialForUser>>

interface Tally {
  scanned: number
  refreshed: number
  skipped: number
  needsReconnect: number
  transientFailure: number
  absent: number
  errored: number
}

/**
 * Exhaustive over RefreshOutcome: the switch has no default case, so adding a
 * new union member to refreshCodexCredentialForUser's return type fails
 * typecheck here instead of silently falling into a catch-all bucket.
 */
function tallyOutcome(tally: Tally, outcome: RefreshOutcome): void {
  switch (outcome) {
    case "refreshed":
      tally.refreshed++
      break
    case "skipped":
      tally.skipped++
      break
    case "needs_reconnect":
      tally.needsReconnect++
      break
    case "transient_failure":
      tally.transientFailure++
      break
    case "absent":
      tally.absent++
      break
    default: {
      const _exhaustive: never = outcome
      throw new Error(`unreachable outcome: ${_exhaustive as string}`)
    }
  }
}

export async function GET(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  // Only users who actually have the credential. Uses the `->` accessor
  // rather than the `?` containment operator: `?` is ambiguous with a driver
  // parameter placeholder inside a Prisma tagged template.
  // `ORDER BY id` is not cosmetic. The sweep is sequential under a 300s
  // budget, so if it ever has more users than it can finish, an unordered
  // scan can hand back the same arbitrary order every hour and strand
  // whichever users land past the cutoff. A stable order makes that failure
  // deterministic and therefore visible (the same tail is always last), and
  // it is the ordering a cursor would page over when this needs batching.
  // Revisit when `scanned` reaches the hundreds.
  const users = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User"
    WHERE credentials -> 'CODEX_CREDENTIALS' IS NOT NULL
    ORDER BY id
  `

  const tally: Tally = {
    scanned: users.length,
    refreshed: 0,
    skipped: 0,
    needsReconnect: 0,
    transientFailure: 0,
    absent: 0,
    errored: 0,
  }

  for (const { id } of users) {
    try {
      const outcome = await refreshCodexCredentialForUser(id)
      tallyOutcome(tally, outcome)
    } catch (err) {
      // One user's failure must not abort the sweep. Log no token material.
      console.error("[refresh-codex-creds] user sweep failed:", (err as Error).message)
      tally.errored++
    }
  }

  return Response.json(tally)
}
