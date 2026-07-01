// Tier-1 data-access layer for the shared Claude credential pool: the single
// owner of all Prisma reads/writes against the CcAuthInfo table.
//
// Deliberately Prisma-weight only — it must NOT import the heavy
// @background-agents/claude-credentials generator (which pulls in
// @daytonaio/sdk -> @opentelemetry -> @grpc). Hot request paths import the read
// helpers here (message send, settings), so keeping this module light matters.
// The generator-dependent orchestration lives in ./server/refresh-claude-credentials.
//
// `server-only` makes the build fail here (not deep in the Prisma chain) if a
// client component ever imports it.
import "server-only"
// Constants come from the package's zero-dep `/constants` subpath, so importing
// them never reaches the SDK. Re-exported for server-side consumers.
import {
  CLAUDE_CREDS_KEY,
  CLAUDE_COOKIES_KEY,
} from "@background-agents/claude-credentials/constants"
import { prisma } from "@/lib/db/prisma"

export { CLAUDE_CREDS_KEY, CLAUDE_COOKIES_KEY }

/**
 * Closes the Prisma connection. Handy for short-lived scripts (e.g. the
 * seed CLI) so the process can exit cleanly.
 */
export async function prismaDisconnect(): Promise<void> {
  await prisma.$disconnect()
}

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
 * Reads the shared Claude credentials row, throwing when it's absent. Use this
 * on request paths that require credentials to already exist.
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
