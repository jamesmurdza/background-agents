import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxBasicWithAuth,
  badRequest,
  notFound,
  internalError,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, action } = body

  if (!sandboxId) {
    return badRequest("Missing sandbox ID")
  }

  // 2. Verify ownership
  const sandboxRecord = await getSandboxBasicWithAuth(sandboxId, auth.userId)
  if (!sandboxRecord) {
    return notFound("Sandbox not found")
  }

  // 3. Get Daytona API key
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    if (action === "stop") {
      await sandbox.stop()
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { status: "stopped" },
      })
      return Response.json({ state: "stopped" })
    }

    if (action === "start") {
      await sandbox.start(120)
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { status: "running" },
      })
      return Response.json({ state: "started" })
    }

    // Update status in DB based on actual state
    const dbStatus = sandbox.state === "started" ? "running" : "stopped"
    if (sandboxRecord.status !== dbStatus) {
      await prisma.sandbox.update({
        where: { id: sandboxRecord.id },
        data: { status: dbStatus },
      })
    }

    return Response.json({ state: sandbox.state })
  } catch (error: unknown) {
    return internalError(error)
  }
}
