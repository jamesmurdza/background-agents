import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError, badRequest, notFound, internalError } from "@/lib/db/api-helpers"
import {
  encryptEnvironmentVariables,
  getOwnedEnvironment,
  toEnvironmentDTO,
  NETWORK_MODES,
} from "@/lib/environments"

interface PatchBody {
  name?: string
  networkMode?: string
  allowedDomains?: string[]
  variables?: Record<string, string>
  setupScript?: string | null
  isDefault?: true
}

// =============================================================================
// GET
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const row = await getOwnedEnvironment(userId, id)
    if (!row) return notFound("Environment not found")
    return Response.json({ environment: toEnvironmentDTO(row) })
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - edit fields, or promote to default
// =============================================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const existing = await getOwnedEnvironment(userId, id)
    if (!existing) return notFound("Environment not found")

    const body: PatchBody = await req.json()

    if (body.networkMode !== undefined) {
      if (!(NETWORK_MODES as readonly string[]).includes(body.networkMode)) {
        return badRequest(`networkMode must be one of: ${NETWORK_MODES.join(", ")}`)
      }

      // Delete this block once @daytonaio/sdk is upgraded past 0.170.0 to a
      // version with a domain-allowlist field (0.185.0+) and
      // buildSandboxCreateParams's matching restricted-mode throw is removed.
      // The installed SDK has no domainAllowList, only "networkBlockAll" and a
      // CIDR-only "networkAllowList", neither of which can express an
      // allowed-hostnames list. Persisting networkMode: "restricted" here
      // would let a user park an environment in a state where every
      // subsequent chat on that repo fails at sandbox creation, so it's
      // refused at the API boundary instead.
      if (body.networkMode === "restricted") {
        return badRequest(
          `Restricted network mode is not enforced yet: the installed @daytonaio/sdk (0.170.0) ` +
            `has no domain-allowlist field, only "networkBlockAll" and a CIDR-only ` +
            `"networkAllowList", neither of which can express an allowed-hostnames list. Keep ` +
            `this environment's network mode set to "full" until the Daytona SDK is upgraded ` +
            `(0.185.0+) to support domain allowlisting.`
        )
      }
    }
    if (body.name !== undefined && !body.name.trim()) {
      return badRequest("name cannot be empty")
    }

    // Promotion runs as two ordered statements inside a transaction. Postgres
    // checks the partial unique index per statement, not deferred, so clearing
    // the old default and setting the new one cannot be a single updateMany.
    if (body.isDefault === true && !existing.isDefault) {
      await prisma.$transaction([
        prisma.environment.updateMany({
          where: { userId, repo: existing.repo, isDefault: true },
          data: { isDefault: false },
        }),
        prisma.environment.update({ where: { id }, data: { isDefault: true } }),
      ])
    }

    const updated = await prisma.environment.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.networkMode !== undefined && { networkMode: body.networkMode }),
        ...(body.allowedDomains !== undefined && {
          allowedDomains: body.allowedDomains.map((d) => d.trim()).filter(Boolean),
        }),
        ...(body.variables !== undefined && {
          environmentVariables: encryptEnvironmentVariables(body.variables),
        }),
        ...(body.setupScript !== undefined && {
          setupScript: body.setupScript,
          setupScriptPrevious: existing.setupScript,
          setupScriptUpdatedBy: "user",
        }),
      },
    })

    return Response.json({ environment: toEnvironmentDTO(updated) })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return badRequest("An environment with that name already exists for this repo")
    }
    return internalError(error)
  }
}

// =============================================================================
// DELETE
// =============================================================================

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const { id } = await params
    const existing = await getOwnedEnvironment(userId, id)
    if (!existing) return notFound("Environment not found")

    // Deleting the default is only allowed when it's the repo's last one; in
    // which case getOrCreateDefaultEnvironment will recreate an empty one on
    // next need. Otherwise the user promotes another to default first, so the
    // repo is never left with several environments and no default.
    if (existing.isDefault) {
      const siblings = await prisma.environment.count({
        where: { userId, repo: existing.repo, NOT: { id } },
      })
      if (siblings > 0) {
        return badRequest("Promote another environment to default before deleting this one")
      }
    }

    // Chats keep their history; environmentId goes null via SetNull and they
    // resolve to the repo's default on their next sandbox.
    await prisma.environment.delete({ where: { id } })
    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
