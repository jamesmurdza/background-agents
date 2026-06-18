/**
 * POST /api/scheduled-jobs/<id>/mcp-servers/github
 *
 * Add a sentinel row pointing at GitHub's hosted MCP. The runtime loader
 * mints fresh installation tokens from the user's githubAppInstallationId.
 */
import { resolveMcpOwner } from "@/lib/mcp/owner"
import { attachGithubResponse } from "@/lib/mcp/connections"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: jobId } = await params
  const resolved = await resolveMcpOwner("job", jobId)
  if (resolved instanceof Response) return resolved
  return attachGithubResponse(resolved.owner, resolved.userId)
}
