import { prisma } from "@/lib/prisma"
import { requireAdmin, isAuthError } from "@/lib/api-helpers"
import { BRANCH_STATUS } from "@/lib/constants"

const ACTIVE_STATUSES = [BRANCH_STATUS.CREATING, BRANCH_STATUS.RUNNING, BRANCH_STATUS.STOPPED]

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = parseInt(searchParams.get("limit") || "20", 10)
  const offset = (page - 1) * limit

  // Build where clause for search
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { githubLogin: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}

  // Get total count and users in parallel
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        githubLogin: true,
        isAdmin: true,
        maxSandboxes: true,
        createdAt: true,
        _count: {
          select: {
            sandboxes: {
              where: { status: { in: ACTIVE_STATUSES } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
  ])

  // Transform response
  const transformedUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    githubLogin: user.githubLogin,
    isAdmin: user.isAdmin,
    maxSandboxes: user.maxSandboxes,
    activeSandboxes: user._count.sandboxes,
    createdAt: user.createdAt,
  }))

  return Response.json({
    users: transformedUsers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
