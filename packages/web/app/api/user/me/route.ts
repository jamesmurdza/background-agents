import { prisma } from "@/lib/db/prisma"
import { getQuota } from "@/lib/sandbox/quota"
import { requireAuth, isAuthError, notFound, internalError } from "@/lib/shared/api-helpers"
import { hasOpenRouterKey } from "@/lib/llm/llm"

// Prevent Next.js from caching this route - always fetch fresh data
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        githubLogin: true,
        isAdmin: true,
        repoOrder: true,
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
            defaultLoopMaxIterations: true,
            loopUntilFinishedEnabled: true,
            useCredentialsFromUserId: true,
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
    const serverLlmFallback = hasOpenRouterKey()

    // If using shared credentials, fetch source user info
    let credentialSourceUser: { id: string; name: string | null; githubLogin: string | null } | null = null
    if (user.credentials?.useCredentialsFromUserId) {
      credentialSourceUser = await prisma.user.findUnique({
        where: { id: user.credentials.useCredentialsFromUserId },
        select: { id: true, name: true, githubLogin: true },
      })
    }

    const credentials = user.credentials
      ? {
          anthropicAuthType: user.credentials.anthropicAuthType,
          hasAnthropicApiKey: !!user.credentials.anthropicApiKey,
          hasAnthropicAuthToken: !!user.credentials.anthropicAuthToken,
          hasOpenaiApiKey: !!user.credentials.openaiApiKey,
          hasOpencodeApiKey: !!user.credentials.opencodeApiKey,
          hasDaytonaApiKey: !!user.credentials.daytonaApiKey,
          sandboxAutoStopInterval: user.credentials.sandboxAutoStopInterval,
          defaultLoopMaxIterations: user.credentials.defaultLoopMaxIterations,
          loopUntilFinishedEnabled: user.credentials.loopUntilFinishedEnabled,
          useCredentialsFromUserId: user.credentials.useCredentialsFromUserId,
          credentialSourceUser,
          ...(serverLlmFallback ? { hasServerLlmFallback: true } : {}),
        }
      : serverLlmFallback
        ? { hasServerLlmFallback: true as const }
        : null

    // Apply saved repo order if it exists
    let orderedRepos = user.repos
    if (user.repoOrder && Array.isArray(user.repoOrder)) {
      const orderMap = new Map((user.repoOrder as string[]).map((id, index) => [id, index]))
      orderedRepos = [...user.repos].sort((a, b) => {
        const posA = orderMap.get(a.id)
        const posB = orderMap.get(b.id)
        // Repos with saved order come first, sorted by position
        // Repos without saved order come last, preserving original order
        if (posA !== undefined && posB !== undefined) return posA - posB
        if (posA !== undefined) return -1
        if (posB !== undefined) return 1
        return 0
      })
    }

    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        githubLogin: user.githubLogin,
        isAdmin: user.isAdmin,
      },
      credentials,
      repos: orderedRepos,
      quota,
    })
  } catch (error) {
    console.error("GET /api/user/me error:", error)
    return internalError(error)
  }
}
