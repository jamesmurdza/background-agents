import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
} from "@/lib/api-helpers"
import { PAGINATION } from "@/lib/constants"
import {
  INCLUDE_REPO_FOR_LIST,
  INCLUDE_REPO_WITH_BRANCHES,
} from "@/lib/prisma-includes"
import { deleteSandboxesForRepo } from "@/lib/daytona-cleanup"

export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    const repos = await prisma.repo.findMany({
      where: { userId: auth.userId },
      include: INCLUDE_REPO_FOR_LIST,
      orderBy: { createdAt: "desc" },
      take: PAGINATION.REPOS_LIST,
    })

    return Response.json({ repos })
  } catch (error) {
    return internalError(error)
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { name, owner, avatar, defaultBranch } = body

  if (!name || !owner || !defaultBranch) {
    return badRequest("Missing required fields")
  }

  try {
    // Check if repo already exists for this user
    const existingRepo = await prisma.repo.findUnique({
      where: {
        userId_owner_name: {
          userId: auth.userId,
          owner,
          name,
        },
      },
    })

    if (existingRepo) {
      return Response.json({ error: "Repository already added" }, { status: 409 })
    }

    const repo = await prisma.repo.create({
      data: {
        userId: auth.userId,
        name,
        owner,
        avatar,
        defaultBranch,
      },
      include: INCLUDE_REPO_WITH_BRANCHES,
    })

    return Response.json({ repo })
  } catch (error) {
    return internalError(error)
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const repoId = searchParams.get("id")

  if (!repoId) {
    return badRequest("Missing repo ID")
  }

  try {
    // Verify ownership
    const repo = await prisma.repo.findUnique({
      where: { id: repoId },
    })

    if (!repo || repo.userId !== auth.userId) {
      return notFound("Repo not found")
    }

    // 1. Delete all Daytona sandboxes for this repo first (cloud + DB records)
    // This must happen before repo deletion since cascade would orphan cloud resources
    const cleanupResult = await deleteSandboxesForRepo(repoId)
    if (cleanupResult.failed > 0) {
      console.warn(
        `[repos/DELETE] Sandbox cleanup: ${cleanupResult.succeeded}/${cleanupResult.total} succeeded for repo ${repoId}`
      )
      // Continue with repo deletion even if some sandbox cleanups had issues
      // The sandboxes may already be deleted or inaccessible
    }

    // 2. Delete repo (cascade will clean up branches, messages, and any remaining sandbox records)
    await prisma.repo.delete({
      where: { id: repoId },
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error(`[repos/DELETE] Error deleting repo ${repoId}:`, error)
    return internalError(error)
  }
}
