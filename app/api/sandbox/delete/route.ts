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
  const { sandboxId } = body

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

    // Try to delete from Daytona - don't fail if sandbox doesn't exist there
    try {
      const sandbox = await daytona.get(sandboxId)
      await sandbox.delete()
    } catch (daytonaError: unknown) {
      // Log but continue - sandbox may already be deleted in Daytona
      console.warn(
        `[sandbox/delete] Daytona delete warning for ${sandboxId}:`,
        daytonaError instanceof Error ? daytonaError.message : "Unknown error"
      )
    }

    // Always delete from database (deleteMany doesn't throw if already gone)
    await prisma.sandbox.deleteMany({
      where: { id: sandboxRecord.id },
    })

    return Response.json({ success: true })
  } catch (error: unknown) {
    console.error(
      `[sandbox/delete] Error deleting sandbox ${sandboxId}:`,
      error instanceof Error ? error.message : "Unknown error"
    )
    return internalError(error)
  }
}
