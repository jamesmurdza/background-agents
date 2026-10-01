import { prisma } from "@/lib/db/prisma"

// Hard-coded constants to avoid importing @background-agents/claude-credentials which
// transitively pulls in @daytonaio/sdk -> @opentelemetry -> @grpc (Node-only)
export const CLAUDE_CREDS_KEY = "claude-credentials"
export const CLAUDE_COOKIES_KEY = "claude-cookies"

/**
 * Reads the shared Claude credentials row, or null when it hasn't been seeded.
 */
export async function readCredentials(): Promise<string | null> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_CREDS_KEY },
    select: { value: true },
  })
  return row?.value ?? null
}

/**
 * Reads the shared Claude Code credentials row from Postgres, throwing when
 * it's absent. Use this on request paths that require credentials to exist.
 */
export async function getClaudeCredentials(): Promise<string> {
  const value = await readCredentials()
  if (value === null) {
    throw new Error(
      `CcAuthInfo row '${CLAUDE_CREDS_KEY}' not found in database`,
    )
  }
  return value
}

/**
 * Upserts the shared Claude credentials row.
 */
export async function writeCredentials(value: string): Promise<void> {
  await prisma.ccAuthInfo.upsert({
    where: { id: CLAUDE_CREDS_KEY },
    create: { id: CLAUDE_CREDS_KEY, value },
    update: { value },
  })
}

/**
 * REVERTED (see commit history): an earlier version of this module stripped
 * claudeAiOauth.refreshToken before a credential reached a sandbox — replacing
 * it with a placeholder via a getSandboxClaudeCredentials() helper, and
 * pairing that with a periodic resync (agent-lifecycle cron) to keep
 * long-running sandboxes' on-disk access token current — to stop a sandbox's
 * CLI from racing the hourly cron's use of the same rotating refresh token.
 *
 * That assumption was wrong: confirmed in production testing that the Claude
 * CLI validates/needs a real-looking refresh token at startup regardless of
 * whether the access token is still fresh — a credential with ~5 hours of
 * access-token life left still failed immediately with "Failed to
 * authenticate: OAuth session expired and could not be refreshed" once its
 * refresh token was replaced with a placeholder, on the very first turn of a
 * brand-new chat. Both the stripping helper and the periodic resync were
 * reverted; every sandbox goes back to getting the real, unmodified
 * credential (including the real refresh token) via getClaudeCredentials(),
 * same as before either change.
 *
 * The underlying race is still real (see CcAuthRun investigation: most
 * observed "OAuth session expired" failures land within seconds of an hourly
 * cron rotation) — it just needs a fix that doesn't touch what's handed to
 * the sandbox, since the CLI depends on having a genuinely usable refresh
 * token at all times. Not yet re-attempted; whatever replaces this should be
 * verified against a real Daytona sandbox + Claude CLI before shipping, not
 * reasoned about from documentation alone — that's what went wrong here.
 */

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

/** A single row of the credential-refresh audit log, serialized for the client. */
export interface CcAuthRunView {
  id: string
  status: string
  code: string | null
  message: string | null
  trigger: string
  forced: boolean
  cookiesUpdated: boolean
  durationMs: number
  expiresAt: string | null
  createdAt: string
}

/**
 * Appends a row to the credential-refresh audit log (see {@link CcAuthRunView}).
 * `expiresAt` is passed as epoch-ms (as it flows through RefreshResult) and
 * stored as a timestamp.
 */
export async function recordCcAuthRun(run: {
  status: string
  code?: string | null
  message?: string | null
  trigger: string
  forced: boolean
  cookiesUpdated: boolean
  durationMs: number
  expiresAt?: number | null
}): Promise<void> {
  await prisma.ccAuthRun.create({
    data: {
      status: run.status,
      code: run.code ?? null,
      message: run.message ?? null,
      trigger: run.trigger,
      forced: run.forced,
      cookiesUpdated: run.cookiesUpdated,
      durationMs: run.durationMs,
      expiresAt: run.expiresAt != null ? new Date(run.expiresAt) : null,
    },
  })
}

/** Returns the most recent credential-refresh runs, newest first. */
export async function listCcAuthRuns(limit = 50): Promise<CcAuthRunView[]> {
  const rows = await prisma.ccAuthRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    code: r.code,
    message: r.message,
    trigger: r.trigger,
    forced: r.forced,
    cookiesUpdated: r.cookiesUpdated,
    durationMs: r.durationMs,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }))
}
