import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// POST endpoint for saving draft prompts (needed for sendBeacon on page unload)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { branchId, draftPrompt } = body

  if (!branchId) {
    return Response.json({ error: "Missing branch ID" }, { status: 400 })
  }

  // Verify ownership
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { repo: true },
  })

  if (!branch || branch.repo.userId !== session.user.id) {
    return Response.json({ error: "Branch not found" }, { status: 404 })
  }

  await prisma.branch.update({
    where: { id: branchId },
    data: { draftPrompt: draftPrompt ?? "" },
  })

  return Response.json({ success: true })
}
