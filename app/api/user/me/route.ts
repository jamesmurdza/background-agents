import { prisma } from "@/lib/prisma"
import { getQuota } from "@/lib/quota"
import { requireAuth, isAuthError, notFound, internalError } from "@/lib/api-helpers"

// Prevent Next.js from caching this route - always fetch fresh data
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        credentials: {
          select: {
            anthropicAuthType: true,
            // Don't send actual keys to client, just whether they exist
            anthropicApiKey: true,
            anthropicAuthToken: true,
            openaiApiKey: true,
            opencodeApiKey: true,
            daytonaApiKey: true,
            sandboxAutoStopInterval: true,
          },
        },
        repos: {
          include: {
            branches: {
              include: {
                sandbox: true,
                // Don't load messages in initial user fetch - load on-demand when branch selected
                messages: false,
                _count: {
                  select: { messages: true }, // Include total count for UI
                },
              },
              orderBy: { updatedAt: "desc" }, // Most recently active branches first
              take: 10, // Limit branches per repo
            },
            _count: {
              select: { branches: true }, // Total branch count for pagination
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20, // Limit repos returned
        },
      },
    })

    if (!user) {
      return notFound("User not found")
    }

    const quota = await getQuota(auth.userId)

    // Transform credentials to just show existence, not values
    const credentials = user.credentials
      ? {
          anthropicAuthType: user.credentials.anthropicAuthType,
          hasAnthropicApiKey: !!user.credentials.anthropicApiKey,
          hasAnthropicAuthToken: !!user.credentials.anthropicAuthToken,
          hasOpenaiApiKey: !!user.credentials.openaiApiKey,
          hasOpencodeApiKey: !!user.credentials.opencodeApiKey,
          hasDaytonaApiKey: !!user.credentials.daytonaApiKey,
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
  } catch (error) {
    console.error("GET /api/user/me error:", error)
    return internalError(error)
  }
}
