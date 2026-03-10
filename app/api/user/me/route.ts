import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getQuota } from "@/lib/quota"

// Prevent Next.js from caching this route - always fetch fresh data
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      credentials: {
        select: {
          anthropicAuthType: true,
          // Don't send actual keys to client, just whether they exist
          anthropicApiKey: true,
          anthropicAuthToken: true,
          sandboxAutoStopInterval: true,
        },
      },
      repos: {
        include: {
          branches: {
            include: {
              sandbox: true,
              messages: {
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { updatedAt: "desc" }, // Most recently active branches first
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 })
  }

  const quota = await getQuota(session.user.id)

  // Transform credentials to just show existence, not values
  const credentials = user.credentials
    ? {
        anthropicAuthType: user.credentials.anthropicAuthType,
        hasAnthropicApiKey: !!user.credentials.anthropicApiKey,
        hasAnthropicAuthToken: !!user.credentials.anthropicAuthToken,
        sandboxAutoStopInterval: user.credentials.sandboxAutoStopInterval,
      }
    : null

  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      githubLogin: user.githubLogin,
    },
    credentials,
    repos: user.repos,
    quota,
  })
}
