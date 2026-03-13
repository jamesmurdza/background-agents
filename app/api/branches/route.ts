import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getRepoWithAuth,
  getBranchWithAuth,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
} from "@/lib/api-helpers"
import { Daytona } from "@daytonaio/sdk"

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
      agent: "claude-code",
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
  const { branchId, status, prUrl, name, draftPrompt, agent, model, clearSession } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership - need to query with sandbox for clearSession
  const branchWithSandbox = await prisma.branch.findUnique({
    where: { id: branchId },
    include: {
      repo: true,
      sandbox: true,
    },
  })

  if (!branchWithSandbox || branchWithSandbox.repo.userId !== userId) {
    return notFound("Branch not found")
  }

  // If clearSession is true and branch has a sandbox, clear its session ID
  if (clearSession && branchWithSandbox.sandbox) {
    // Clear session ID from database
    await prisma.sandbox.update({
      where: { id: branchWithSandbox.sandbox.id },
      data: { sessionId: null },
    })

    // Also clear the session file in the sandbox
    const daytonaApiKey = getDaytonaApiKey()
    if (!isDaytonaKeyError(daytonaApiKey)) {
      try {
        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.get(branchWithSandbox.sandbox.sandboxId)
        await sandbox.process.executeCommand("rm -f /home/daytona/.agent_session_id")
      } catch (err) {
        console.error("Failed to clear session file:", err)
        // Non-critical, continue
      }
    }
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
