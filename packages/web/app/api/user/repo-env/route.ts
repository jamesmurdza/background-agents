import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  decodeEnvVars,
  encodeEnvVars,
  envVarSecretsEnabled,
  parseEnvVarSet,
  repoEnvScope,
  syncEnvVarSecrets,
} from "@/lib/server/env-var-secrets"
import type { SecretEnvHosts } from "@/lib/types"

// =============================================================================
// Types
// =============================================================================

interface RepoEnvVarsResponse {
  repoEnvironmentVariables: Record<string, Record<string, string>>
  /** Per repo: the vars protected as Daytona secrets, and the hosts each may be sent to. */
  repoSecretEnvironmentVariables: Record<string, SecretEnvHosts>
  /** Whether marking a var as a secret takes effect (see lib/server/env-var-secrets). */
  envSecretsAvailable: boolean
}

interface PatchRepoEnvVarsBody {
  repo: string
  environmentVariables: Record<string, string>
  secretEnvironmentVariables?: SecretEnvHosts
}

// =============================================================================
// GET - Fetch all repository environment variables for the user (decrypted)
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })

    const stored = (user?.repoEnvironmentVariables as Record<string, unknown>) || {}
    const response: RepoEnvVarsResponse = {
      repoEnvironmentVariables: {},
      repoSecretEnvironmentVariables: {},
      envSecretsAvailable: envVarSecretsEnabled(),
    }
    for (const [repo, envVars] of Object.entries(stored)) {
      const { values, secretHosts } = decodeEnvVars(envVars)
      response.repoEnvironmentVariables[repo] = values
      if (Object.keys(secretHosts).length > 0) response.repoSecretEnvironmentVariables[repo] = secretHosts
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update environment variables for a specific repository
// =============================================================================

export async function PATCH(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: PatchRepoEnvVarsBody = await req.json()

    if (!body.repo || typeof body.repo !== "string") {
      return badRequest("Invalid repo")
    }

    const set = parseEnvVarSet(body.environmentVariables, body.secretEnvironmentVariables)
    if (typeof set === "string") return badRequest(set)

    // Get current repo env vars
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })

    const allRepoEnvVars = (user?.repoEnvironmentVariables as Record<string, unknown>) || {}

    // Update or remove the repo entry
    if (Object.keys(set.values).length > 0) {
      allRepoEnvVars[body.repo] = encodeEnvVars(set)
    } else {
      delete allRepoEnvVars[body.repo]
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        repoEnvironmentVariables: allRepoEnvVars as Record<string, object>,
      },
    })
    await syncEnvVarSecrets(userId, repoEnvScope(body.repo), set)

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
