/**
 * Daily sweep deleting Daytona secrets nothing has used in a while: any of
 * this app's secrets unused for {@link UNUSED_MS} (see
 * @background-agents/sandbox-secrets' `deleteStaleSecrets`).
 *
 * Reports only, unless DAYTONA_SECRET_CLEANUP=1: secrets live in the Daytona
 * org, which other deployments (local dev, previews) may share, so only the
 * one deployment whose settings are the truth should delete. `?dryRun=1`
 * reports even then.
 */
import { Daytona } from "@daytonaio/sdk"
import { deleteStaleSecrets } from "@background-agents/sandbox-secrets"

// maxDuration configures the timeout for this Vercel function.
export const maxDuration = 300

/** Secrets unused for this long are deleted. */
const UNUSED_MS = 24 * 60 * 60 * 1000

export async function GET(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return Response.json({ skipped: "DAYTONA_API_KEY is not set" })

  const dryRun = process.env.DAYTONA_SECRET_CLEANUP !== "1" || new URL(req.url).searchParams.get("dryRun") === "1"
  try {
    const deleted = await deleteStaleSecrets(new Daytona({ apiKey }), UNUSED_MS, { dryRun })
    console.log(`[secret-cleanup] ${dryRun ? "would delete" : "deleted"} ${deleted.length} unused secret(s)`)
    return Response.json({ dryRun, deleted: deleted.length })
  } catch (err) {
    console.error("[secret-cleanup] sweep failed:", err)
    return Response.json({ error: "Secret cleanup failed" }, { status: 500 })
  }
}
