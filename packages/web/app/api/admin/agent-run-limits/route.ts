import { NextRequest, NextResponse } from "next/server"

import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { logActivity } from "@/lib/db/activity-log"
import { getAgentRunLimitsRow, setAgentRunLimits } from "@/lib/db/agent-run-limits"

/**
 * Admin read/write for the max agent run duration — the /admin "Development"
 * panel. See lib/db/agent-run-limits for the cached read path the
 * agent-lifecycle cron actually enforces against, and its hardcoded defaults
 * in app/api/cron/agent-lifecycle/_lib/constants.
 */

export interface AgentRunLimitsResponse {
  interactiveMinutes: number
  scheduledMinutes: number
  updatedAt: string | null
  updatedBy: string | null
}

export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const row = await getAgentRunLimitsRow()

  return NextResponse.json({
    interactiveMinutes: row.interactiveMinutes,
    scheduledMinutes: row.scheduledMinutes,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    updatedBy: row.updatedBy,
  } satisfies AgentRunLimitsResponse)
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  let body: { interactiveMinutes?: unknown; scheduledMinutes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { interactiveMinutes, scheduledMinutes } = body
  if (typeof interactiveMinutes !== "number" || typeof scheduledMinutes !== "number") {
    return NextResponse.json(
      { error: "interactiveMinutes and scheduledMinutes must be numbers" },
      { status: 400 }
    )
  }

  try {
    await setAgentRunLimits({ interactiveMinutes, scheduledMinutes }, auth.userId)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set run limits" },
      { status: 400 }
    )
  }

  await logActivity(auth.userId, "agent_run_limits_updated", {
    interactiveMinutes,
    scheduledMinutes,
  })

  return NextResponse.json({ interactiveMinutes, scheduledMinutes })
}
