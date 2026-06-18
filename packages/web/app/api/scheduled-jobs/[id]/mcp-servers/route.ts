/**
 * GET  /api/scheduled-jobs/<id>/mcp-servers     list connections on this job
 * POST /api/scheduled-jobs/<id>/mcp-servers     start a new connection via Smithery
 *
 * Thin wrappers around the owner-parameterized handlers in lib/mcp/connections.
 */
import { badRequest } from "@/lib/db/api-helpers"
import { resolveMcpOwner } from "@/lib/mcp/owner"
import {
  connectSmitheryResponse,
  listConnectionsResponse,
  type ConnectSmitheryBody,
} from "@/lib/mcp/connections"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: jobId } = await params
  const resolved = await resolveMcpOwner("job", jobId)
  if (resolved instanceof Response) return resolved
  return listConnectionsResponse(resolved.owner)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: jobId } = await params
  const resolved = await resolveMcpOwner("job", jobId)
  if (resolved instanceof Response) return resolved

  let body: ConnectSmitheryBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }
  return connectSmitheryResponse(resolved.owner, body)
}
