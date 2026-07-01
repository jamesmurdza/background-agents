// Tier-1 (server-only): this module reads Prisma and reaches the heavy
// @daytonaio/sdk (gRPC, Node-only) generator. The `server-only` import makes
// the build fail — pointing here — if any client component ever imports it,
// instead of surfacing as a cryptic gRPC bundling error.
import "server-only"
import { generateClaudeCredentials } from "@background-agents/claude-credentials"
// Constants come from the package's zero-dep `/constants` subpath, so importing
// them never pulls in @daytonaio/sdk -> @opentelemetry -> @grpc. This module
// itself is server-only (it imports prisma + the ccauth generator), so it also
// re-exports them for existing server-side consumers.
import {
  CLAUDE_CREDS_KEY,
  CLAUDE_COOKIES_KEY,
} from "@background-agents/claude-credentials/constants"
import { prisma } from "@/lib/db/prisma"

export { CLAUDE_CREDS_KEY, CLAUDE_COOKIES_KEY }

// Skip refresh while the live credential still has at least this much life.
// Anthropic OAuth access tokens are 8h-lived, so 2h leaves us 6 hours of cron
// retries before stale-token risk.
const SKIP_THRESHOLD_MS = 2 * 60 * 60 * 1000

/**
 * Closes the Prisma connection. Handy for short-lived scripts (e.g. the
 * seed CLI) so the process can exit cleanly.
 */
export async function prismaDisconnect(): Promise<void> {
  await prisma.$disconnect()
}

/**
 * Reads the shared Claude Code credentials row from Postgres.
 */
export async function getClaudeCredentials(): Promise<string> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_CREDS_KEY },
    select: { value: true },
  })
  if (!row) {
    throw new Error(
      `CcAuthInfo row '${CLAUDE_CREDS_KEY}' not found in database`,
    )
  }
  return row.value
}

/**
 * Returns true when the shared Claude credential pool has been seeded.
 */
export async function isSharedPoolAvailable(): Promise<boolean> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_CREDS_KEY },
    select: { id: true },
  })
  return !!row
}

/**
 * Reads the raw claude.ai session cookies row, or null when it hasn't been
 * seeded yet.
 */
export async function getCookies(): Promise<string | null> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_COOKIES_KEY },
    select: { value: true },
  })
  return row?.value ?? null
}

/**
 * Upserts the raw claude.ai session cookies. These are the long-lived root
 * secret: `refreshCredentials` regenerates the short-lived OAuth token from
 * them, but the cookies themselves must be rotated by hand (they eventually
 * expire on claude.ai) via `npm run seed:ccauth`.
 */
export async function setCookies(cookies: string): Promise<void> {
  await prisma.ccAuthInfo.upsert({
    where: { id: CLAUDE_COOKIES_KEY },
    create: { id: CLAUDE_COOKIES_KEY, value: cookies },
    update: { value: cookies },
  })
}

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
    const credsRow = await prisma.ccAuthInfo.findUnique({
      where: { id: CLAUDE_CREDS_KEY },
      select: { value: true },
    })
    if (credsRow) {
      try {
        const parsed = JSON.parse(credsRow.value) as {
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
          "[claude-credentials] Existing creds row unparseable:",
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
    console.error("[claude-credentials] ccauth failed:", err)
    return {
      status: "error",
      code: "CCAUTH_FAILED",
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const value = JSON.stringify(creds)
  await prisma.ccAuthInfo.upsert({
    where: { id: CLAUDE_CREDS_KEY },
    create: { id: CLAUDE_CREDS_KEY, value },
    update: { value },
  })

  return { status: "refreshed", expiresAt: creds.claudeAiOauth.expiresAt }
}
