import { badRequest, requireDaytona, requireSandboxOwner } from "@/lib/db/api-helpers"

export async function POST(req: Request) {
  const body = await req.json()
  const { sandboxId } = body

  if (!sandboxId) {
    return badRequest("Missing sandboxId")
  }

  const owner = await requireSandboxOwner(sandboxId)
  if (owner instanceof Response) return owner

  const daytona = requireDaytona()
  if (daytona instanceof Response) return daytona

  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()

    return Response.json({ success: true })
  } catch (error) {
    console.error("[sandbox/delete] Error:", error)
    // Don't fail if sandbox doesn't exist - it may have already been deleted
    const message = error instanceof Error ? error.message : "Unknown error"
    if (message.includes("not found") || message.includes("404")) {
      return Response.json({ success: true, alreadyDeleted: true })
    }
    return Response.json({ error: message }, { status: 500 })
  }
}
