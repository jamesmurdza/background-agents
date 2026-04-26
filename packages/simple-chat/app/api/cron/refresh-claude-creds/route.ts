import { prisma } from "@/lib/db/prisma"
import {
  CLAUDE_COOKIES_KEY,
  CLAUDE_CREDS_KEY,
  generateClaudeCredentials,
} from "@/lib/claude-credentials"

// Skip refresh while the live credential still has at least this much life.
// Anthropic OAuth access tokens are 8h-lived, so 2h leaves us 6 hours of cron
// retries before stale-token risk.
const SKIP_THRESHOLD_MS = 2 * 60 * 60 * 1000

// Daytona's first build of the ccauth image can take a few minutes; after the
// snapshot is cached, subsequent runs are fast. 300s fits Pro plan limits;
// pre-warm the cache via `npm run seed:ccauth` to avoid cold-start risk.
export const maxDuration = 300

export async function GET(req: Request) {
  if (
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response("Unauthorized", { status: 401 })
  }

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
        return Response.json({ skipped: true, expiresAt })
      }
    } catch (err) {
      // Malformed row — fall through and overwrite.
      console.warn(
        "[cron/refresh-claude-creds] Existing creds row unparseable:",
        err,
      )
    }
  }

  const cookiesRow = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_COOKIES_KEY },
    select: { value: true },
  })
  if (!cookiesRow) {
    return Response.json(
      {
        error: "COOKIES_UNAVAILABLE",
        message: `CcAuthInfo row '${CLAUDE_COOKIES_KEY}' not found — seed it first with npm run seed:ccauth.`,
      },
      { status: 500 },
    )
  }

  let creds
  try {
    creds = await generateClaudeCredentials(cookiesRow.value)
  } catch (err) {
    console.error("[cron/refresh-claude-creds] ccauth failed:", err)
    return Response.json(
      {
        error: "CCAUTH_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }

  const value = JSON.stringify(creds)
  await prisma.ccAuthInfo.upsert({
    where: { id: CLAUDE_CREDS_KEY },
    create: { id: CLAUDE_CREDS_KEY, value },
    update: { value },
  })

  return Response.json({
    refreshed: true,
    expiresAt: creds.claudeAiOauth.expiresAt,
  })
}
