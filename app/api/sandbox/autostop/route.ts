import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { interval } = body

  // Validate interval (5-20 minutes)
  if (typeof interval !== "number" || interval < 5 || interval > 20) {
    return Response.json({ error: "Invalid interval. Must be between 5 and 20 minutes." }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Server configuration error: Daytona API key not set" }, { status: 500 })
  }

  // Get all user's sandboxes
  const sandboxes = await prisma.sandbox.findMany({
    where: { userId: session.user.id },
    select: { sandboxId: true },
  })

  if (sandboxes.length === 0) {
    return Response.json({ success: true, updated: 0, failed: 0 })
  }

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  let updated = 0
  let failed = 0

  // Update each sandbox's autostop interval
  for (const { sandboxId } of sandboxes) {
    try {
      const sandbox = await daytona.get(sandboxId)
      await sandbox.setAutostopInterval(interval)
      updated++
    } catch (error) {
      // Sandbox may have been deleted or is in an invalid state
      console.error(`Failed to update autostop for sandbox ${sandboxId}:`, error)
      failed++
    }
  }

  return Response.json({ success: true, updated, failed })
}
