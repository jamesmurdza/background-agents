import { prisma } from "@/lib/prisma"
import { requireAdmin, isAuthError, badRequest, notFound } from "@/lib/api-helpers"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { userId } = await params

  // Validate user exists
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!existingUser) {
    return notFound("User not found")
  }

  // Parse and validate request body
  let body: { maxSandboxes?: number | null; isAdmin?: boolean }
  try {
    body = await request.json()
  } catch {
    return badRequest("Invalid JSON body")
  }

  // Validate maxSandboxes if provided
  if (body.maxSandboxes !== undefined && body.maxSandboxes !== null) {
    if (typeof body.maxSandboxes !== "number" || body.maxSandboxes < 1 || body.maxSandboxes > 100) {
      return badRequest("maxSandboxes must be a number between 1 and 100, or null for default")
    }
  }

  // Validate isAdmin if provided
  if (body.isAdmin !== undefined && typeof body.isAdmin !== "boolean") {
    return badRequest("isAdmin must be a boolean")
  }

  // Build update data
  const updateData: { maxSandboxes?: number | null; isAdmin?: boolean } = {}
  if (body.maxSandboxes !== undefined) {
    updateData.maxSandboxes = body.maxSandboxes
  }
  if (body.isAdmin !== undefined) {
    updateData.isAdmin = body.isAdmin
  }

  // Update user
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      githubLogin: true,
      isAdmin: true,
      maxSandboxes: true,
    },
  })

  return Response.json({ user: updatedUser })
}
