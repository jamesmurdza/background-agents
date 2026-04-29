import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { logActivity } from "@/lib/db/activity-log"

/**
 * PATCH /api/admin/users/[userId]
 * Update user properties (e.g., toggle admin status)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { userId: targetUserId } = await params

  // Parse request body
  let body: { isAdmin?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Validate the target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isAdmin: true, name: true },
  })

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Prevent admins from demoting themselves
  if (targetUserId === auth.userId && body.isAdmin === false) {
    return NextResponse.json(
      { error: "Cannot remove your own admin status" },
      { status: 400 }
    )
  }

  // Build update data
  const updateData: { isAdmin?: boolean } = {}
  if (typeof body.isAdmin === "boolean") {
    updateData.isAdmin = body.isAdmin
  }

  // If no valid updates, return error
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  // Update the user
  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      isAdmin: true,
    },
  })

  // Log admin status changes
  if (typeof body.isAdmin === "boolean" && body.isAdmin !== targetUser.isAdmin) {
    await logActivity(
      auth.userId,
      body.isAdmin ? "admin_promoted" : "admin_demoted",
      {
        targetUserId,
        targetUserName: targetUser.name,
      }
    )
  }

  return NextResponse.json({
    user: updatedUser,
    message: `User ${updatedUser.name || updatedUser.id} updated successfully`,
  })
}
