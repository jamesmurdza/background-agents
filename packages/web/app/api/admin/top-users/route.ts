import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { getTopUsers } from "@/lib/db/admin-stats"

/**
 * GET /api/admin/top-users
 * Returns top active users for a given time range
 *
 * Query params:
 * - range: Time range - "24h", "7d", or "30d" (default: "30d")
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const searchParams = request.nextUrl.searchParams
  const range = searchParams.get("range") || "30d"

  // Calculate interval based on range
  let interval: string
  switch (range) {
    case "24h":
      interval = "24 hours"
      break
    case "7d":
      interval = "7 days"
      break
    case "30d":
    default:
      interval = "30 days"
      break
  }

  const topUsers = await getTopUsers(interval, false)

  return NextResponse.json({ topUsers })
}
