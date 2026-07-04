import {
  refreshCredentials,
  refreshResultToResponse,
} from "@/lib/server/refresh-claude-credentials"

// Daytona's first build of the ccauth image can take a few minutes; after the
// snapshot is cached, subsequent runs are fast. 300s fits Pro plan limits;
// pre-warm the cache via `npm run seed:ccauth` to avoid cold-start risk.
export const maxDuration = 300

export async function GET(req: Request) {
  // Verify cron secret (skip auth if not configured, for local development)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  // `?force=1` bypasses the skip-while-fresh threshold so a token can be
  // regenerated on demand for testing. The hourly cron never sets it.
  const force = ["1", "true"].includes(
    new URL(req.url).searchParams.get("force") ?? "",
  )

  const result = await refreshCredentials({ force, trigger: "cron" })
  return refreshResultToResponse(result)
}
