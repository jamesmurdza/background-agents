/**
 * Daily sweep deleting Daytona secrets nothing uses any more: any of ours
 * unused for a day, and sooner those of deleted users, removed pool keys,
 * replaced tokens and settings (see lib/server/secret-cleanup).
 *
 * Reports only, unless DAYTONA_SECRET_CLEANUP=1: secrets live in the Daytona
 * org, which other deployments (local dev, previews) may share with
 * different keys configured, so only the one deployment whose settings are
 * the truth should delete. `?dryRun=1` reports even then.
 */
import { Daytona } from "@daytonaio/sdk"
import { cleanupSecrets } from "@/lib/server/secret-cleanup"

// maxDuration configures the timeout for this Vercel function.
export const maxDuration = 300

export async function GET(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return Response.json({ skipped: "DAYTONA_API_KEY is not set" })

  const dryRun = process.env.DAYTONA_SECRET_CLEANUP !== "1" || new URL(req.url).searchParams.get("dryRun") === "1"
  try {
    const report = await cleanupSecrets(new Daytona({ apiKey }), { dryRun })
    console.log(
      `[secret-cleanup] ${dryRun ? "would delete" : "deleted"} ${report.deleted.length} of ${report.scanned} secrets` +
        ` (${report.mounted} mounted, ${report.young} too new, ${report.ignored} not ours, ${report.errors} failed)`
    )
    return Response.json(report)
  } catch (err) {
    console.error("[secret-cleanup] sweep failed:", err)
    return Response.json({ error: "Secret cleanup failed" }, { status: 500 })
  }
}
