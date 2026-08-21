import { ensureSandboxStarted } from "@/lib/sandbox"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { internalError, badRequest, requireDaytona, requireSandboxOwner } from "@/lib/db/api-helpers"

export const maxDuration = 30

/**
 * POST /api/sandbox/ssh
 *
 * Creates a short-lived SSH access for the sandbox and returns the ssh command
 * so the browser can construct a `vscode://vscode-remote/ssh-remote+host/path`
 * link for opening the workspace in VS Code.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sandboxId?: string } | null
  if (!body) return badRequest("Invalid JSON body")
  const { sandboxId } = body
  if (!sandboxId) return badRequest("Missing sandboxId")

  const owner = await requireSandboxOwner(sandboxId)
  if (owner instanceof Response) return owner

  const daytona = requireDaytona()
  if (daytona instanceof Response) return daytona

  try {
    const sandbox = await getSandboxOrExpired(daytona, sandboxId)
    if (sandbox instanceof Response) return sandbox
    await ensureSandboxStarted(sandbox)
    const sshAccess = await sandbox.createSshAccess(60)
    return Response.json({ sshCommand: sshAccess.sshCommand })
  } catch (error) {
    console.error("[sandbox/ssh] Error:", error)
    return internalError(error)
  }
}
