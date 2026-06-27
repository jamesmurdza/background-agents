import { Daytona } from "@daytonaio/sdk"
import { rebuildSnapshot } from "@background-agents/sandbox-image"

// Manual, on-demand zero-downtime snapshot rebuild. Not on a cron schedule —
// trigger it yourself when you need a fresh image. It runs two serial image
// builds (build temp → swap → rebuild canonical), so it can take many minutes;
// for a full production rebuild prefer `npm run build:snapshot` (no timeout).
export const maxDuration = 300

export async function POST(req: Request) {
  // Verify secret (skip auth if not configured, for local development).
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "DAYTONA_API_KEY not configured" },
      { status: 500 }
    )
  }

  const daytona = new Daytona({ apiKey })

  try {
    const snapshot = await rebuildSnapshot(daytona, {
      onLog: (line) => console.log(`[snapshot/rebuild] ${line}`),
    })

    return Response.json({
      success: true,
      message: "Snapshot rebuilt successfully",
      activeSnapshot: snapshot.name,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[snapshot/rebuild] failed:", err)
    return Response.json(
      {
        error: "SNAPSHOT_REBUILD_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
