/**
 * GET  /api/scheduled-jobs/<id>/mcp-servers     list connections on this job
 * POST /api/scheduled-jobs/<id>/mcp-servers     start a new connection via Smithery
 *
 * Thin wrappers around the owner-parameterized handlers in lib/mcp/connections.
 */
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/db/api-helpers"
import { requireMcpOwnerAuth, type McpOwner } from "@/lib/mcp/owner"
import {
  connectSmitheryResponse,
  listConnectionsResponse,
  type ConnectSmitheryBody,
} from "@/lib/mcp/connections"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id: jobId } = await params

  const owner: McpOwner = { kind: "job", id: jobId }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    return notFound("Scheduled job not found")
  }
  return listConnectionsResponse(owner)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { id: jobId } = await params

  const owner: McpOwner = { kind: "job", id: jobId }
  if (!(await requireMcpOwnerAuth(owner, auth.userId))) {
    return notFound("Scheduled job not found")
  }

  let body: ConnectSmitheryBody
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }
  return connectSmitheryResponse(owner, body)
}
