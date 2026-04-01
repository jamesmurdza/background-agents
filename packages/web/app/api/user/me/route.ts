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
          },
        },
        // Include team membership info
        teamMembership: {
          include: {
            team: {
              include: {
                owner: {
                  select: { id: true, name: true, githubLogin: true, image: true },
                },
              },
            },
          },
        },
        ownedTeam: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, name: true, githubLogin: true, image: true },
                },
              },
            },
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
          ...(serverLlmFallback ? { hasServerLlmFallback: true } : {}),
        }
      : serverLlmFallback
        ? { hasServerLlmFallback: true as const }
        : null

    // Build team info
    const team = user.ownedTeam
      ? {
          isOwner: true as const,
          members: user.ownedTeam.members.map((m) => ({
            id: m.user.id,
            name: m.user.name,
            githubLogin: m.user.githubLogin,
            image: m.user.image,
            joinedAt: m.createdAt,
          })),
        }
      : user.teamMembership
        ? {
            isOwner: false as const,
            owner: {
              id: user.teamMembership.team.owner.id,
              name: user.teamMembership.team.owner.name,
              githubLogin: user.teamMembership.team.owner.githubLogin,
              image: user.teamMembership.team.owner.image,
            },
          }
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
      team,
      repos: orderedRepos,
      quota,
    })
  } catch (error) {
    console.error("GET /api/user/me error:", error)
    return internalError(error)
  }
}
