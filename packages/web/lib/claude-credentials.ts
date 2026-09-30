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
 * Placeholder written in place of the real `refreshToken` whenever the shared
 * credential is handed to a sandbox. A sandbox's Claude CLI never needs the
 * real refresh token: only refreshCredentials() (the hourly cron / admin
 * action) is allowed to rotate it. Previously the raw stored value — refresh
 * token included — was injected as-is, which let a sandbox's CLI self-refresh
 * with `grant_type=refresh_token` using the SAME token the cron was also
 * using. Anthropic's refresh tokens are single-use/rotating, so whichever
 * side used it second got rejected — surfacing as "Failed to authenticate:
 * OAuth session expired and could not be refreshed" even though the shared
 * pool's access token was still perfectly valid at the time. See
 * getSandboxClaudeCredentials, which is what actually strips it.
 */
export const CLAUDE_PLACEHOLDER_REFRESH_TOKEN = "placeholder-managed-server-side"

/**
 * Returns the shared Claude credential JSON safe to inject into a sandbox:
 * same accessToken/expiresAt as the stored value, but with claudeAiOauth.
 * refreshToken replaced by {@link CLAUDE_PLACEHOLDER_REFRESH_TOKEN}.
 *
 * Use this — never the raw getClaudeCredentials() — anywhere the value is
 * about to be written into a sandbox's CLAUDE_CODE_CREDENTIALS env var /
 * .credentials.json file. getClaudeCredentials() itself stays available for
 * server-only reads that need the real value (e.g. refreshCredentials()).
 */
export async function getSandboxClaudeCredentials(): Promise<string> {
  return stripRefreshToken(await getClaudeCredentials())
}

/**
 * Replaces claudeAiOauth.refreshToken with the placeholder. Malformed/
 * unparseable input is returned unchanged rather than thrown: this sits on a
 * hot request path that already has a value to inject, and a stray parse
 * failure here shouldn't turn into a 500 for something the CLI would surface
 * as its own clear startup error anyway.
 *
 * Deliberately does its own inline shape check instead of importing
 * isClaudeOAuthCredentials from @background-agents/claude-credentials — this
 * module is kept Prisma-weight on purpose (see refresh-claude-credentials.ts).
 */
function stripRefreshToken(value: string): string {
  try {
    const parsed = JSON.parse(value) as {
      claudeAiOauth?: Record<string, unknown>
    }
    if (parsed.claudeAiOauth && typeof parsed.claudeAiOauth === "object") {
      return JSON.stringify({
        ...parsed,
        claudeAiOauth: {
          ...parsed.claudeAiOauth,
          refreshToken: CLAUDE_PLACEHOLDER_REFRESH_TOKEN,
        },
      })
    }
  } catch (err) {
    console.error("[claude-credentials] Stored credential is not valid JSON:", err)
  }
  return value
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
