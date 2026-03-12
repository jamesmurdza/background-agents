import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { anthropicApiKey, anthropicAuthType, anthropicAuthToken, openaiApiKey, sandboxAutoStopInterval } = body

  if (!anthropicAuthType || !["api-key", "claude-max"].includes(anthropicAuthType)) {
    return badRequest("Invalid auth type")
  }

  // Validate sandboxAutoStopInterval if provided
  if (sandboxAutoStopInterval !== undefined) {
    if (typeof sandboxAutoStopInterval !== "number" || sandboxAutoStopInterval < 5 || sandboxAutoStopInterval > 20) {
      return badRequest("Invalid auto-stop interval. Must be between 5 and 20 minutes.")
    }
  }

  // Encrypt credentials before storing
  const encryptedApiKey = anthropicApiKey ? encrypt(anthropicApiKey) : null
  const encryptedAuthToken = anthropicAuthToken ? encrypt(anthropicAuthToken) : null
  const encryptedOpenaiKey = openaiApiKey ? encrypt(openaiApiKey) : null

  await prisma.userCredentials.upsert({
    where: { userId },
    update: {
      anthropicApiKey: encryptedApiKey,
      anthropicAuthType,
      anthropicAuthToken: encryptedAuthToken,
      openaiApiKey: encryptedOpenaiKey,
      ...(sandboxAutoStopInterval !== undefined && { sandboxAutoStopInterval }),
    },
    create: {
      userId,
      anthropicApiKey: encryptedApiKey,
      anthropicAuthType,
      anthropicAuthToken: encryptedAuthToken,
      openaiApiKey: encryptedOpenaiKey,
      ...(sandboxAutoStopInterval !== undefined && { sandboxAutoStopInterval }),
    },
  })

  return Response.json({ success: true })
}

export async function DELETE() {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  await prisma.userCredentials.deleteMany({
    where: { userId },
  })

  return Response.json({ success: true })
}
