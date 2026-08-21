import { ensureSandboxStarted } from "@/lib/sandbox"
import { getSandboxOrExpired, passiveReadGate } from "@/lib/sandbox-lifecycle"
import { badRequest, requireDaytona, requireSandboxOwner } from "@/lib/db/api-helpers"

export const maxDuration = 30

/**
 * POST /api/sandbox/state
 *
 * Lightweight lifecycle probe for panels that need to know whether a sandbox is
 * usable before rendering (e.g. the server/web preview, which otherwise embeds a
 * broken iframe against a stopped sandbox).
 *
 * Body: { sandboxId: string, autoStart?: boolean }
 * Responses: 200 { state: "ready" } · 409 stopped · 410 expired
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sandboxId?: string
    autoStart?: boolean
  } | null

  if (!body?.sandboxId) return badRequest("Missing sandboxId")

  const owner = await requireSandboxOwner(body.sandboxId)
  if (owner instanceof Response) return owner

  const daytona = requireDaytona()
  if (daytona instanceof Response) return daytona

  const sandbox = await getSandboxOrExpired(daytona, body.sandboxId)
  if (sandbox instanceof Response) return sandbox

  // Passive by default — a stopped sandbox is only booted on explicit refresh.
  const halt = passiveReadGate(sandbox, body.autoStart)
  if (halt) return halt

  await ensureSandboxStarted(sandbox)
  return Response.json({ state: "ready" })
}
