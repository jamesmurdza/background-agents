import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError, internalError } from "@/lib/api-helpers"

// Lightweight sync endpoint for cross-device state synchronization
// Returns all repos with branch statuses, last message info, etc.
export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    // Get all repos for user with branch info
    const repos = await prisma.repo.findMany({
      where: {
        userId: auth.userId,
      },
      select: {
        id: true,
        name: true,
        owner: true,
        avatar: true,
        defaultBranch: true,
        branches: {
          select: {
            id: true,
            name: true,
            status: true,
            baseBranch: true,
            prUrl: true,
            agent: true,
            model: true,
            sandbox: {
              select: {
                sandboxId: true,
                status: true,
              },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                createdAt: true,
              },
            },
          },
        },
      },
    })

    // Return compact sync data
    const syncData = {
      timestamp: Date.now(),
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        owner: r.owner,
        avatar: r.avatar,
        defaultBranch: r.defaultBranch,
        branches: r.branches.map((b) => ({
          id: b.id,
          name: b.name,
          status: b.status,
          baseBranch: b.baseBranch,
          prUrl: b.prUrl,
          agent: b.agent,
          model: b.model,
          sandboxId: b.sandbox?.sandboxId || null,
          sandboxStatus: b.sandbox?.status || null,
          lastMessageId: b.messages[0]?.id || null,
          lastMessageAt: b.messages[0]?.createdAt?.getTime() || null,
        })),
      })),
    }

    return Response.json(syncData)
  } catch (error) {
    console.error("Sync error:", error)
    return internalError(error)
  }
}
