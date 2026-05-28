import { prisma } from "@/lib/db/prisma"

// Hard-coded constants to avoid importing @background-agents/claude-credentials which
// transitively pulls in @daytonaio/sdk -> @opentelemetry -> @grpc (Node-only)
export const CLAUDE_CREDS_KEY = "claude-credentials"
export const CLAUDE_COOKIES_KEY = "claude-cookies"

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
