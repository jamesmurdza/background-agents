import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import {
  setCookies,
  writeCredentials,
  listCcAuthRuns,
} from "@/lib/claude-credentials"
import {
  refreshCredentials,
  refreshResultToResponse,
} from "@/lib/server/refresh-claude-credentials"

// Mirrors the cron route's budget — the first ccauth run in Daytona can take a
// few minutes before the snapshot is cached.
export const maxDuration = 300

/**
 * GET /api/admin/refresh-claude-creds
 *
 * Returns the recent credential-refresh audit log (cron + admin runs) for the
 * admin "Credentials" tab, newest first.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const runs = await listCcAuthRuns(50)
  return NextResponse.json({ runs })
}

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
  let cookiesUpdated = false

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
    cookiesUpdated = true
  }

  const result = await refreshCredentials({
    force,
    trigger: "admin",
    cookiesUpdated,
  })
  return refreshResultToResponse(result)
}

/**
 * PUT /api/admin/refresh-claude-creds
 *
 * Stores a credentials blob pasted by hand, for when neither refresh path can
 * run (expired cookies, ccauth blocked) but a working token is available from
 * somewhere else — previously this meant editing the row in the database.
 * Body: { credentials: string } — the contents of ~/.claude/.credentials.json.
 *
 * The blob is stored as pasted, so every field it carries (expiresAt, scopes,
 * subscriptionType, …) reaches the sandbox exactly as Claude Code wrote it.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const body = (await request.json().catch(() => ({}))) as {
    credentials?: unknown
  }
  const raw = typeof body.credentials === "string" ? body.credentials.trim() : ""

  let parsed: { claudeAiOauth?: Record<string, unknown> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { error: "INVALID_CREDENTIALS", message: "Credentials must be valid JSON." },
      { status: 400 },
    )
  }

  const oauth = parsed?.claudeAiOauth
  if (
    !oauth ||
    typeof oauth.accessToken !== "string" ||
    typeof oauth.refreshToken !== "string"
  ) {
    return NextResponse.json(
      {
        error: "INVALID_CREDENTIALS",
        message:
          "Expected {\"claudeAiOauth\":{\"accessToken\":\"…\",\"refreshToken\":\"…\"}}.",
      },
      { status: 400 },
    )
  }

  // Re-stringify rather than storing `raw`: the value is echoed into a shell
  // command when the sandbox writes .credentials.json, so it must be one line.
  await writeCredentials(JSON.stringify(parsed))

  return NextResponse.json({
    saved: true,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
  })
}
