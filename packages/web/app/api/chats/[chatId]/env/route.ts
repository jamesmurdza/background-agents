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
import { encrypt, decrypt } from "@/lib/db/encryption"
import { findInvalidEnvVarKey, isValidEnvVarKey } from "@/lib/environments"

// =============================================================================
// Types
// =============================================================================

interface EnvVarsResponse {
  environmentVariables: Record<string, string>
}

interface PatchEnvVarsBody {
  environmentVariables: Record<string, string>
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

    // Decrypt environment variables
    const encrypted = (chat.environmentVariables as Record<string, string>) || {}
    const decrypted: Record<string, string> = {}
    for (const [key, value] of Object.entries(encrypted)) {
      if (value) {
        decrypted[key] = decrypt(value)
      }
    }

    const response: EnvVarsResponse = {
      environmentVariables: decrypted,
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

    if (!body.environmentVariables || typeof body.environmentVariables !== "object") {
      return badRequest("Invalid environmentVariables")
    }

    const invalidKey = findInvalidEnvVarKey(body.environmentVariables)
    if (invalidKey !== null) {
      return badRequest(
        `Invalid environment variable name: "${invalidKey}". Names must match ` +
          `^[A-Za-z_][A-Za-z0-9_]*$ (letters, digits, and underscore only; cannot start with a digit).`
      )
    }

    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Encrypt all values. isValidEnvVarKey is checked again here (not just
    // above) so nothing malformed can reach storage through this loop even if
    // the pre-check above is ever bypassed or changed.
    const encrypted: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.environmentVariables)) {
      const trimmed = key.trim()
      if (typeof key === "string" && typeof value === "string" && trimmed && isValidEnvVarKey(trimmed)) {
        encrypted[trimmed] = encrypt(value)
      }
    }

    await prisma.chat.update({
      where: { id: chatId },
      data: {
        environmentVariables: encrypted,
      },
    })

    return Response.json({ success: true })
  } catch (error) {
    return internalError(error)
  }
}
