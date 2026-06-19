import { Daytona } from "@daytonaio/sdk"
import { rotateSnapshot } from "@background-agents/sandbox-image"
import { requireCronSecret } from "@/lib/db/api-helpers"

// Building the snapshot can take several minutes
export const maxDuration = 300

export async function GET(req: Request) {
  // Verify cron secret
  const denied = requireCronSecret(req)
  if (denied) return denied

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "DAYTONA_API_KEY not configured" },
      { status: 500 }
    )
  }

  const daytona = new Daytona({ apiKey })

  try {
    const result = await rotateSnapshot(daytona, {
      onLog: (line) => console.log(`[cron/rebuild-snapshot] ${line}`),
    })

    return Response.json({
      success: true,
      message: "Snapshot rotated successfully",
      activeSnapshot: result.snapshot.name,
      deactivatedSnapshot: result.deactivatedName ?? null,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[cron/rebuild-snapshot] failed:", err)
    return Response.json(
      {
        error: "SNAPSHOT_ROTATION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
