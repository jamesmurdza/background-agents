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
