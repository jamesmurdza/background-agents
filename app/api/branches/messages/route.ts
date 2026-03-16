import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getBranchWithAuth,
  badRequest,
  notFound,
} from "@/lib/api-helpers"
import { INCLUDE_MESSAGE_WITH_BRANCH } from "@/lib/prisma-includes"

// Prevent Next.js from caching this route - always fetch fresh data
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("branchId")
  const cursor = searchParams.get("cursor") // For pagination
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500) // Default 100, max 500
  const summary = searchParams.get("summary") === "true" // If true, return only metadata (no content)

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership - if branch doesn't exist yet (newly created), return empty messages
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return Response.json({
      messages: [],
      pagination: {
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
      },
    })
  }

  // When summary=true, only fetch metadata to reduce network transfer
  // Full content is loaded on-demand when user views a specific branch
  const messages = await prisma.message.findMany({
    where: { branchId },
    orderBy: { createdAt: "asc" },
    take: limit,
    ...(cursor && {
      skip: 1,
      cursor: { id: cursor },
    }),
    ...(summary && {
      select: {
        id: true,
        role: true,
        createdAt: true,
        timestamp: true,
        commitHash: true,
        commitMessage: true,
      },
    }),
  })

  // Get total count for pagination info
  const totalCount = await prisma.message.count({
    where: { branchId },
  })

  const nextCursor = messages.length === limit ? messages[messages.length - 1]?.id : null

  return Response.json({
    messages,
    pagination: {
      totalCount,
      hasMore: !!nextCursor,
      nextCursor,
    },
  })
}

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { branchId, role, content, toolCalls, contentBlocks, timestamp, commitHash, commitMessage } = body

  if (!branchId || !role) {
    return badRequest("Missing required fields")
  }

  // Verify ownership
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return notFound("Branch not found")
  }

  const message = await prisma.message.create({
    data: {
      branchId,
      role,
      content: content || "",
      toolCalls,
      contentBlocks,
      timestamp,
      commitHash,
      commitMessage,
    },
  })

  return Response.json({ message })
}

// Update a message (for streaming updates)
export async function PATCH(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { messageId, content, toolCalls, contentBlocks } = body

  if (!messageId) {
    return badRequest("Missing message ID")
  }

  // Verify ownership through branch -> repo
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: INCLUDE_MESSAGE_WITH_BRANCH,
  })

  if (!message || message.branch.repo.userId !== userId) {
    return notFound("Message not found")
  }

  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: {
      ...(content !== undefined && { content }),
      ...(toolCalls !== undefined && { toolCalls }),
      ...(contentBlocks !== undefined && { contentBlocks }),
    },
  })

  return Response.json({ message: updatedMessage })
}
