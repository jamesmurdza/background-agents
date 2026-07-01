/**
 * Server-only orchestration for refreshing the shared Claude credential pool.
 *
 * This is the ONLY module (besides the seed CLI) that imports the heavy
 * @background-agents/claude-credentials generator, which pulls in
 * @daytonaio/sdk -> @opentelemetry -> @grpc (Node-only). It's kept separate
 * from lib/claude-credentials.ts so the read helpers that sit on hot request
 * paths stay Prisma-weight. All DB access is delegated to that data-access
 * layer; this module only composes it with the generator.
 */

// Enforces the server-only contract and, more importantly, quarantines the
// gRPC-heavy generator import to this file.
import "server-only"
import { generateClaudeCredentials } from "@background-agents/claude-credentials"
import {
  readCredentials,
  writeCredentials,
  getCookies,
  CLAUDE_COOKIES_KEY,
} from "@/lib/claude-credentials"

// Skip refresh while the live credential still has at least this much life.
// Anthropic OAuth access tokens are 8h-lived, so 2h leaves us 6 hours of cron
// retries before stale-token risk.
const SKIP_THRESHOLD_MS = 2 * 60 * 60 * 1000

export type RefreshResult =
  | { status: "skipped"; expiresAt: number }
  | { status: "refreshed"; expiresAt: number }
  | {
      status: "error"
      code: "COOKIES_UNAVAILABLE" | "CCAUTH_FAILED"
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
  opts: { force?: boolean } = {},
): Promise<RefreshResult> {
  if (!opts.force) {
    const existing = await readCredentials()
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as {
          claudeAiOauth?: { expiresAt?: number }
        }
        const expiresAt = parsed.claudeAiOauth?.expiresAt
        if (
          typeof expiresAt === "number" &&
          expiresAt - Date.now() > SKIP_THRESHOLD_MS
        ) {
          return { status: "skipped", expiresAt }
        }
      } catch (err) {
        // Malformed row — fall through and overwrite.
        console.warn(
          "[refresh-claude-credentials] Existing creds row unparseable:",
          err,
        )
      }
    }
  }

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
    creds = await generateClaudeCredentials(cookies)
  } catch (err) {
    console.error("[refresh-claude-credentials] ccauth failed:", err)
    return {
      status: "error",
      code: "CCAUTH_FAILED",
      message: err instanceof Error ? err.message : String(err),
    }
  }

  await writeCredentials(JSON.stringify(creds))
  return { status: "refreshed", expiresAt: creds.claudeAiOauth.expiresAt }
}
