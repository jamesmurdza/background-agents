import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  chatEnvScope,
  decodeEnvVars,
  encodeEnvVars,
  envVarSecretsEnabled,
  parseEnvVarSet,
  syncEnvVarSecrets,
} from "@/lib/server/env-var-secrets"
import type { SecretEnvHosts } from "@/lib/types"

// =============================================================================
// Types
// =============================================================================

interface EnvVarsResponse {
  environmentVariables: Record<string, string>
  /** The vars protected as Daytona secrets, and the hosts each may be sent to. */
  secretEnvironmentVariables: SecretEnvHosts
  /** Whether marking a var as a secret takes effect (see lib/server/env-var-secrets). */
  envSecretsAvailable: boolean
}

interface PatchEnvVarsBody {
  environmentVariables: Record<string, string>
  secretEnvironmentVariables?: SecretEnvHosts
}

// =============================================================================
// GET - Fetch chat environment variables (decrypted)
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    const { values, secretHosts } = decodeEnvVars(chat.environmentVariables)
    const response: EnvVarsResponse = {
      environmentVariables: values,
      secretEnvironmentVariables: secretHosts,
      envSecretsAvailable: envVarSecretsEnabled(),
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update chat environment variables
// =============================================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const body: PatchEnvVarsBody = await req.json()
    const set = parseEnvVarSet(body.environmentVariables, body.secretEnvironmentVariables)
    if (typeof set === "string") return badRequest(set)

    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    await prisma.chat.update({
      where: { id: chatId },
      data: {
        environmentVariables: encodeEnvVars(set),
      },
    })
    await syncEnvVarSecrets(userId, chatEnvScope(chatId), set)

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
