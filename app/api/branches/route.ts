import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getRepoWithAuth,
  getBranchWithAuth,
  badRequest,
  notFound,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { repoId, name, baseBranch, startCommit } = body

  if (!repoId || !name) {
    return badRequest("Missing required fields")
  }

  // Verify repo ownership
  const repo = await getRepoWithAuth(repoId, userId)
  if (!repo) {
    return notFound("Repo not found")
  }

  // Check if branch already exists
  const existingBranch = await prisma.branch.findUnique({
    where: {
      repoId_name: {
        repoId,
        name,
      },
    },
  })

  if (existingBranch) {
    return Response.json({ error: "Branch already exists" }, { status: 409 })
  }

  const branch = await prisma.branch.create({
    data: {
      repoId,
      name,
      baseBranch,
      startCommit,
      status: "idle",
    },
    include: {
      sandbox: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100, // Limit messages to prevent OOM on large conversations
      },
      _count: {
        select: { messages: true }, // Include total count for pagination
      },
    },
  })

  return Response.json({ branch })
}

export async function DELETE(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("id")

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership through repo
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return notFound("Branch not found")
  }

  await prisma.branch.delete({
    where: { id: branchId },
  })

  return Response.json({ success: true })
}

// Update branch status/metadata
export async function PATCH(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { branchId, status, prUrl, name, draftPrompt, agent, model } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return notFound("Branch not found")
  }

  const updatedBranch = await prisma.branch.update({
    where: { id: branchId },
    data: {
      ...(status && { status }),
      ...(prUrl !== undefined && { prUrl }),
      ...(name && { name }),
      ...(draftPrompt !== undefined && { draftPrompt }),
      ...(agent && { agent }),
      ...(model !== undefined && { model }),
    },
    include: {
      sandbox: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100, // Limit messages to prevent OOM on large conversations
      },
      _count: {
        select: { messages: true }, // Include total count for pagination
      },
    },
  })

  return Response.json({ branch: updatedBranch })
}
