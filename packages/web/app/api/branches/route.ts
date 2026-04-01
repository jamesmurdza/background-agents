import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getRepoWithAuth,
  getBranchWithAuth,
  badRequest,
  notFound,
  internalError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  resolveUserCredentials,
} from "@/lib/shared/api-helpers"
import { PATHS } from "@/lib/shared/constants"
import {
  INCLUDE_BRANCH_WITH_MESSAGES,
  INCLUDE_BRANCH_WITH_REPO_AND_SANDBOX,
} from "@/lib/db/prisma-includes"
import { Daytona } from "@daytonaio/sdk"
import { getDefaultAgent } from "@/lib/shared/types"
import { deleteSandboxForBranch } from "@/lib/sandbox/daytona-cleanup"

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

  // Determine default agent based on user credentials
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })
  const { anthropicApiKey, anthropicAuthToken } = await resolveUserCredentials(userCredentials, userId)
  const defaultAgent = getDefaultAgent({
    hasAnthropicApiKey: !!anthropicApiKey,
    hasAnthropicAuthToken: !!anthropicAuthToken,
  })

  const branch = await prisma.branch.create({
    data: {
      repoId,
      name,
      baseBranch,
      startCommit,
      status: "idle",
      agent: defaultAgent,
    },
    include: INCLUDE_BRANCH_WITH_MESSAGES,
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

  try {
    // 1. Delete Daytona sandbox first (cloud + DB record)
    // This must happen before branch deletion since cascade would orphan the cloud resource
    const cleanupResult = await deleteSandboxForBranch(branchId)
    if (cleanupResult && !cleanupResult.success) {
      console.warn(
        `[branches/DELETE] Sandbox cleanup warning for branch ${branchId}:`,
        cleanupResult.error
      )
      // Continue with branch deletion even if sandbox cleanup had issues
      // The sandbox may already be deleted or inaccessible
    }

    // 2. Delete branch (cascade will clean up messages and any remaining sandbox record)
    await prisma.branch.delete({
      where: { id: branchId },
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error(`[branches/DELETE] Error deleting branch ${branchId}:`, error)
    return internalError(error)
  }
}

// Update branch status/metadata
export async function PATCH(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { branchId, status, prUrl, name, draftPrompt, agent, model, clearSession, loopEnabled, loopCount, loopMaxIterations, lastShownCommitHash } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership - need to query with sandbox for clearSession
  const branchWithSandbox = await prisma.branch.findUnique({
    where: { id: branchId },
    include: INCLUDE_BRANCH_WITH_REPO_AND_SANDBOX,
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
        await sandbox.process.executeCommand(`rm -f ${PATHS.AGENT_SESSION_FILE}`)
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
      ...(loopEnabled !== undefined && { loopEnabled }),
      ...(loopCount !== undefined && { loopCount }),
      ...(loopMaxIterations !== undefined && { loopMaxIterations }),
      ...(lastShownCommitHash !== undefined && { lastShownCommitHash }),
    },
    include: INCLUDE_BRANCH_WITH_MESSAGES,
  })

  return Response.json({ branch: updatedBranch })
}
