import { NextRequest } from "next/server"
import { notFound, internalError } from "@/lib/db/api-helpers"
import { getSharedChat } from "@/lib/server/shared-chat"

// =============================================================================
// GET /api/share/[shareId] — public, read-only view of a shared chat
// =============================================================================
//
// No auth: anyone with the unguessable token can read it. The payload is
// sanitized in getSharedChat() — sandbox/session ids, env vars, branch, and
// tool-call `filePath`s are stripped so nothing private leaks to viewers.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
): Promise<Response> {
  const { shareId } = await params

  try {
    const chat = await getSharedChat(shareId)
    if (!chat) return notFound("Shared chat not found")
    return Response.json(chat)
  } catch (error) {
    return internalError(error)
  }
}
