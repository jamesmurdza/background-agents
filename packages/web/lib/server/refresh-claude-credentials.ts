/**
 * Server-only orchestration for refreshing the shared Claude credential pool.
 *
 * This is the ONLY module (besides the seed CLI) that imports the heavy
 * @background-agents/claude-credentials generator, which pulls in
 * @daytonaio/sdk -> @opentelemetry -> @grpc (Node-only). It's kept separate
 * from lib/claude-credentials.ts so the read helpers that sit on hot request
 * paths stay Prisma-weight. The generator is only the fallback now: a refresh
 * normally spends the stored refresh token directly (lib/server/claude-oauth),
 * under a lock on the credentials row.
 */

// Enforces the server-only contract and, more importantly, quarantines the
// gRPC-heavy generator import to this file.
import "server-only"
import {
  generateClaudeCredentials,
  isClaudeOAuthCredentials,
  CLAUDE_COOKIES_KEY,
  type ClaudeOAuthCredentials,
} from "@background-agents/claude-credentials"
import {
  CLAUDE_CREDS_KEY,
  readCredentials,
  writeCredentials,
  getCookies,
  recordCcAuthRun,
} from "@/lib/claude-credentials"
import { prisma } from "@/lib/db/prisma"
import {
  ClaudeRefreshRejectedError,
  claudeTokenExpiring,
  parseClaudeCredentials,
  refreshClaudeOAuth,
} from "@/lib/server/claude-oauth"
import { pruneClaudeSharedSecrets } from "@/lib/server/subscription-secrets"

// Skip refresh while the live credential still has at least this much life.
// Anthropic OAuth access tokens are 8h-lived, so 2h leaves us 6 hours of cron
// retries before stale-token risk.
const SKIP_THRESHOLD_MS = 2 * 60 * 60 * 1000

export type RefreshResult =
  | { status: "skipped"; expiresAt: number }
  | { status: "refreshed"; expiresAt: number }
  | {
      status: "error"
      code: "COOKIES_UNAVAILABLE" | "CCAUTH_FAILED" | "REFRESH_FAILED"
      message: string
    }

/**
 * Regenerates the shared OAuth credentials from the stored cookies and upserts
 * them into the `claude-credentials` row.
 *
 * Unless `force` is set, this no-ops (`{ status: "skipped" }`) while the current
 * token still has more than SKIP_THRESHOLD_MS of life, so the cron can run
 * frequently without hammering Daytona/ccauth.
 *
 * Returns an `error` variant (rather than throwing) for the two expected
 * operational failures so callers can map them to HTTP responses:
 *   - COOKIES_UNAVAILABLE — the cookies row hasn't been seeded.
 *   - CCAUTH_FAILED       — ccauth couldn't mint a token (often expired cookies).
 */
export async function refreshCredentials(
  opts: {
    force?: boolean
    /** Who triggered this run, recorded in the audit log. Defaults to "cron". */
    trigger?: "cron" | "admin"
    /** Whether the caller rotated the stored cookies just before this run. */
    cookiesUpdated?: boolean
  } = {},
): Promise<RefreshResult> {
  const startedAt = Date.now()
  const result = await runRefresh(opts.force ?? false)
  const durationMs = Date.now() - startedAt

  // Append to the audit log powering the admin "Credentials" tab. Never let a
  // logging failure mask the actual refresh outcome.
  try {
    await recordCcAuthRun({
      status: result.status,
      code: result.status === "error" ? result.code : null,
      message: result.status === "error" ? result.message : null,
      trigger: opts.trigger ?? "cron",
      forced: opts.force ?? false,
      cookiesUpdated: opts.cookiesUpdated ?? false,
      durationMs,
      expiresAt: result.status === "error" ? null : result.expiresAt,
    })
  } catch (err) {
    console.error("[refresh-claude-credentials] Failed to record run:", err)
  }

  return result
}

async function runRefresh(force: boolean): Promise<RefreshResult> {
  const existing = await readCredentials()

  let current: ClaudeOAuthCredentials | null = null
  if (existing) {
    try {
      const parsed = JSON.parse(existing)
      if (isClaudeOAuthCredentials(parsed)) {
        current = parsed
        if (!force && current.claudeAiOauth.expiresAt - Date.now() > SKIP_THRESHOLD_MS) {
          return { status: "skipped", expiresAt: current.claudeAiOauth.expiresAt }
        }
      }
    } catch (err) {
      // Malformed row — fall through and overwrite.
      console.warn(
        "[refresh-claude-credentials] Existing creds row unparseable:",
        err,
      )
    }
  }

  // Preferred path: renew from the refresh token — Claude Code's own
  // grant_type=refresh_token call, made from here: no browser, no sandbox, no
  // ccauth. Only when the refresh token itself is dead do we fall through to
  // the full cookie-based flow.
  if (current?.claudeAiOauth.refreshToken) {
    try {
      const result = await refreshSharedUnderLock(force)
      if (result) {
        if (result.status === "refreshed") await pruneClaudeSharedSecrets()
        return result
      }
      // The row vanished or turned unparseable meanwhile: seed it from cookies.
    } catch (err) {
      if (err instanceof ClaudeRefreshRejectedError) {
        console.warn(
          "[refresh-claude-credentials] refresh token rejected; falling back to ccauth:",
          err.message,
        )
        // fall through to the cookie flow below
      } else {
        // Transient refresh failure — don't spin up the heavy ccauth browser
        // flow; let the next run retry the cheap refresh.
        console.error("[refresh-claude-credentials] token refresh failed:", err)
        return {
          status: "error",
          code: "REFRESH_FAILED",
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }
  }

  // Fallback: full cookie-based OAuth flow (first run, or refresh token expired).
  const cookies = await getCookies()
  if (!cookies) {
    return {
      status: "error",
      code: "COOKIES_UNAVAILABLE",
      message: `CcAuthInfo row '${CLAUDE_COOKIES_KEY}' not found — seed it first with npm run seed:ccauth.`,
    }
  }

  let creds
  try {
    creds = await generateClaudeCredentials({ cookies })
  } catch (err) {
    console.error("[refresh-claude-credentials] ccauth failed:", err)
    return {
      status: "error",
      code: "CCAUTH_FAILED",
      message: err instanceof Error ? err.message : String(err),
    }
  }

  await writeCredentials(JSON.stringify(creds))
  await pruneClaudeSharedSecrets()
  return { status: "refreshed", expiresAt: creds.claudeAiOauth.expiresAt }
}

/**
 * Spend the shared refresh token under a row lock, so the cron and an admin
 * refresh can't both spend it (the loser's would be dead: they rotate). The
 * row is re-read inside the lock, and a refresh someone else just finished
 * is not repeated unless `force`d. Null when there is no usable row.
 */
async function refreshSharedUnderLock(
  force: boolean,
): Promise<Extract<RefreshResult, { status: "skipped" | "refreshed" }> | null> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CcAuthInfo" WHERE id = ${CLAUDE_CREDS_KEY} FOR UPDATE`
      const row = await tx.ccAuthInfo.findUnique({ where: { id: CLAUDE_CREDS_KEY }, select: { value: true } })
      const creds = row ? parseClaudeCredentials(row.value) : null
      if (!creds) return null
      if (!force && !claudeTokenExpiring(creds, SKIP_THRESHOLD_MS)) {
        return { status: "skipped", expiresAt: creds.claudeAiOauth.expiresAt }
      }
      const next = await refreshClaudeOAuth(creds)
      // Persist before anything else: the old refresh token is dead now.
      await tx.ccAuthInfo.update({ where: { id: CLAUDE_CREDS_KEY }, data: { value: JSON.stringify(next) } })
      return { status: "refreshed", expiresAt: next.claudeAiOauth.expiresAt }
    },
    // The refresh is an outbound call made while holding the lock (bounded at
    // 15s itself); the default 5s would abort after Anthropic rotated the token
    // but before it is saved.
    { timeout: 30_000 },
  )
}

/**
 * Maps a {@link RefreshResult} to the JSON HTTP response shared by every route
 * that triggers a refresh (the hourly cron and the admin panel action), so the
 * response shape stays in one place.
 */
export function refreshResultToResponse(result: RefreshResult): Response {
  switch (result.status) {
    case "skipped":
      return Response.json({ skipped: true, expiresAt: result.expiresAt })
    case "refreshed":
      return Response.json({ refreshed: true, expiresAt: result.expiresAt })
    case "error":
      return Response.json(
        { error: result.code, message: result.message },
        { status: 500 },
      )
  }
}
