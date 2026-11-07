import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import { encrypt } from "@/lib/db/encryption"
import { decryptStoredEnvVar } from "@/lib/server/stored-env-vars"

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

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })

    // Decrypt all repo environment variables
    const encrypted = (user?.repoEnvironmentVariables as Record<string, Record<string, string>>) || {}
    const decrypted: Record<string, Record<string, string>> = {}

    for (const [repo, envVars] of Object.entries(encrypted)) {
      decrypted[repo] = {}
      for (const [key, value] of Object.entries(envVars)) {
        if (value) {
          decrypted[repo][key] = decryptStoredEnvVar(value)
        }
      }
    }

    const response: RepoEnvVarsResponse = {
      repoEnvironmentVariables: decrypted,
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

    if (!body.environmentVariables || typeof body.environmentVariables !== "object") {
      return badRequest("Invalid environmentVariables")
    }

    // Get current repo env vars
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })

    const allRepoEnvVars = (user?.repoEnvironmentVariables as Record<string, Record<string, string>>) || {}

    // Encrypt all values for this repo
    const encrypted: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.environmentVariables)) {
      if (typeof key === "string" && typeof value === "string" && key.trim()) {
        encrypted[key.trim()] = encrypt(value)
      }
    }

    // Update or remove the repo entry
    if (Object.keys(encrypted).length > 0) {
      allRepoEnvVars[body.repo] = encrypted
    } else {
      delete allRepoEnvVars[body.repo]
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        repoEnvironmentVariables: allRepoEnvVars,
      },
    })

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
