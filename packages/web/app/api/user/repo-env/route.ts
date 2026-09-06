import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  decryptEnvironmentVariables,
  encryptEnvironmentVariables,
  getOrCreateDefaultEnvironment,
} from "@/lib/environments"

// =============================================================================
// Types
// =============================================================================

interface RepoEnvVarsResponse {
  repoEnvironmentVariables: Record<string, Record<string, string>>
}

interface PatchRepoEnvVarsBody {
  repo: string
  environmentVariables: Record<string, string>
}

// =============================================================================
// GET - Fetch all repository environment variables for the user (decrypted)
// =============================================================================
//
// This endpoint predates per-repo Environment rows; it now reads/writes the
// repo's *default* Environment rather than the legacy
// User.repoEnvironmentVariables JSON column, which nothing else reads
// anymore. The wire contract is unchanged so existing clients
// (useSandboxActions.ts + the env vars modal) keep working untouched.

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const defaultEnvironments = await prisma.environment.findMany({
      where: { userId, isDefault: true },
      select: { repo: true, environmentVariables: true },
    })

    const repoEnvironmentVariables: Record<string, Record<string, string>> = {}
    for (const env of defaultEnvironments) {
      repoEnvironmentVariables[env.repo] = decryptEnvironmentVariables(env.environmentVariables)
    }

    const response: RepoEnvVarsResponse = { repoEnvironmentVariables }

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

    if (!body.environmentVariables || typeof body.environmentVariables !== "object") {
      return badRequest("Invalid environmentVariables")
    }

    const defaultEnv = await getOrCreateDefaultEnvironment(userId, body.repo)
    const encrypted = encryptEnvironmentVariables(body.environmentVariables)

    // An empty environmentVariables clears the values but must not delete the
    // Environment row — that would take its name, network mode, and setup
    // script with it.
    await prisma.environment.update({
      where: { id: defaultEnv.id },
      data: { environmentVariables: encrypted },
    })

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
