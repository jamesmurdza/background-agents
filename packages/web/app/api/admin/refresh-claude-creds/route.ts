import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { setCookies } from "@/lib/claude-credentials"
import {
  refreshCredentials,
  refreshResultToResponse,
} from "@/lib/server/refresh-claude-credentials"

// Mirrors the cron route's budget — the first ccauth run in Daytona can take a
// few minutes before the snapshot is cached.
export const maxDuration = 300

/**
 * POST /api/admin/refresh-claude-creds
 *
 * Admin-authed counterpart to the /api/cron/refresh-claude-creds endpoint: lets
 * an admin refresh the shared Claude credential pool from the panel without the
 * CRON_SECRET. Body:
 *   - force?:   boolean — bypass the skip-while-fresh threshold (force refresh).
 *   - cookies?: string  — optional new claude.ai cookies JSON; when present it's
 *                         validated and stored before the refresh runs.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const body = (await request.json().catch(() => ({}))) as {
    force?: unknown
    cookies?: unknown
  }
  const force = body.force === true
  const cookies = typeof body.cookies === "string" ? body.cookies.trim() : ""

  if (cookies) {
    try {
      JSON.parse(cookies) // sanity check before storing, matches run-ccauth.ts
    } catch {
      return NextResponse.json(
        { error: "INVALID_COOKIES", message: "Cookies must be valid JSON." },
        { status: 400 },
      )
    }
    await setCookies(cookies)
  }

  const result = await refreshCredentials({ force })
  return refreshResultToResponse(result)
}
