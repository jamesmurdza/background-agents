import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import {
  toEnvironmentDTO,
  environmentUniqueConstraintMessage,
  type EnvironmentDTO,
} from "@/lib/environments"

export type { EnvironmentDTO }

interface CreateBody {
  repo: string
  name: string
  /** When set, copy network settings, variables, and setup script from this id. */
  duplicateOf?: string
}

// =============================================================================
// GET - list the user's environments, optionally filtered by repo
// =============================================================================

export async function GET(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const repo = new URL(req.url).searchParams.get("repo")
    const rows = await prisma.environment.findMany({
      where: { userId, ...(repo && { repo }) },
      orderBy: [{ repo: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    })
    return Response.json({ environments: rows.map(toEnvironmentDTO) })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// POST - create, optionally by duplicating an existing environment
// =============================================================================

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: CreateBody = await req.json()
    if (!body.repo || typeof body.repo !== "string") return badRequest("repo is required")
    if (!body.name?.trim()) return badRequest("name is required")

    let source: Awaited<ReturnType<typeof prisma.environment.findFirst>> = null
    if (body.duplicateOf) {
      source = await prisma.environment.findFirst({
        where: { id: body.duplicateOf, userId },
      })
      if (!source) return notFound("Environment not found")
      if (source.repo !== body.repo) return badRequest("Cannot duplicate across repos")

      // Duplication copies networkMode verbatim below, so a restricted source
      // would otherwise let a "restricted" row appear via a path that never
      // showed the PATCH rejection message. Delete alongside the matching
      // check in PATCH once @daytonaio/sdk is upgraded past 0.170.0 to a
      // version with a domain-allowlist field.
      if (source.networkMode === "restricted") {
        return badRequest(
          `Cannot duplicate: restricted network mode is not enforced yet. The installed ` +
            `@daytonaio/sdk (0.170.0) has no domain-allowlist field, only "networkBlockAll" and ` +
            `a CIDR-only "networkAllowList", neither of which can express an allowed-hostnames ` +
            `list. Set the source environment's network mode to "full" before duplicating it, or ` +
            `wait for the Daytona SDK upgrade (0.185.0+).`
        )
      }
    }

    // First environment for a repo becomes its default; later ones do not.
    const existingCount = await prisma.environment.count({ where: { userId, repo: body.repo } })

    const created = await prisma.environment.create({
      data: {
        userId,
        repo: body.repo,
        name: body.name.trim(),
        isDefault: existingCount === 0,
        networkMode: source?.networkMode ?? "full",
        allowedDomains: source?.allowedDomains ?? [],
        // Ciphertext copied verbatim: no decrypt/re-encrypt round trip, so
        // values never exist in plaintext on this path.
        environmentVariables: source?.environmentVariables ?? undefined,
        setupScript: source?.setupScript ?? null,
      },
    })

    return Response.json({ environment: toEnvironmentDTO(created) }, { status: 201 })
  } catch (error) {
    // Environment has two unique constraints that both throw P2002: the named
    // (userId, repo, name) one and the partial default-per-repo index that
    // the isDefault: existingCount === 0 create above can race against.
    // environmentUniqueConstraintMessage tells them apart; anything that
    // isn't a P2002 is a real error and must not become a 400.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return badRequest(environmentUniqueConstraintMessage(error))
    }
    return internalError(error)
  }
}
