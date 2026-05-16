import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  badRequest,
} from "@/lib/db/api-helpers"
import { searchSkills } from "@upstream/skills/registry"

// =============================================================================
// GET - Search skills from Skills.sh registry
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult

  const { searchParams } = new URL(req.url)
  const query = searchParams.get("q")

  if (!query?.trim()) {
    return badRequest("q (search query) is required")
  }

  const { results, error } = await searchSkills(query)

  if (error) {
    // Map error types to appropriate HTTP status codes
    if (error === "Skills registry unavailable") {
      return Response.json({ error, results: [] }, { status: 502 })
    }
    if (error === "Skills registry timed out") {
      return Response.json({ error, results: [] }, { status: 504 })
    }
    return Response.json({ error, results: [] }, { status: 500 })
  }

  return Response.json({ results })
}
