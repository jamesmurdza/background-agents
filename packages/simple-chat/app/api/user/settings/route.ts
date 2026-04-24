import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { encrypt, decrypt } from "@/lib/db/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"

// =============================================================================
// Types
// =============================================================================

interface StoredSettings {
  defaultAgent?: string
  defaultModel?: string
  theme?: "light" | "dark" | "system"
}

interface StoredCredentials {
  anthropicApiKey?: string
  anthropicAuthToken?: string
  openaiApiKey?: string
  opencodeApiKey?: string
  geminiApiKey?: string
}

interface SettingsResponse {
  settings: StoredSettings
  // Never return raw credentials, only flags indicating which are set
  credentialFlags: {
    hasAnthropicApiKey: boolean
    hasAnthropicAuthToken: boolean
    hasOpenaiApiKey: boolean
    hasOpencodeApiKey: boolean
    hasGeminiApiKey: boolean
  }
}

// =============================================================================
// GET - Fetch user settings and credential flags
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true, credentials: true },
    })

    const settings = (user?.settings as StoredSettings) ?? {}
    const credentials = (user?.credentials as StoredCredentials) ?? {}

    // Decrypt credentials to check if they exist (non-empty after decrypt)
    const response: SettingsResponse = {
      settings: {
        defaultAgent: settings.defaultAgent ?? "opencode",
        defaultModel: settings.defaultModel ?? "opencode/big-pickle",
        theme: settings.theme ?? "system",
      },
      credentialFlags: {
        hasAnthropicApiKey: !!credentials.anthropicApiKey && !!decrypt(credentials.anthropicApiKey),
        hasAnthropicAuthToken: !!credentials.anthropicAuthToken && !!decrypt(credentials.anthropicAuthToken),
        hasOpenaiApiKey: !!credentials.openaiApiKey && !!decrypt(credentials.openaiApiKey),
        hasOpencodeApiKey: !!credentials.opencodeApiKey && !!decrypt(credentials.opencodeApiKey),
        hasGeminiApiKey: !!credentials.geminiApiKey && !!decrypt(credentials.geminiApiKey),
      },
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update user settings and/or credentials
// =============================================================================

interface PatchBody {
  settings?: Partial<StoredSettings>
  credentials?: Partial<StoredCredentials>
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: PatchBody = await req.json()

    if (!body.settings && !body.credentials) {
      return badRequest("Must provide settings or credentials to update")
    }

    // Get current user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true, credentials: true },
    })

    const currentSettings = (user?.settings as StoredSettings) ?? {}
    const currentCredentials = (user?.credentials as StoredCredentials) ?? {}

    // Merge settings
    const newSettings: StoredSettings = body.settings
      ? { ...currentSettings, ...body.settings }
      : currentSettings

    // Merge and encrypt credentials
    let newCredentials: StoredCredentials = currentCredentials
    if (body.credentials) {
      newCredentials = { ...currentCredentials }

      // Only update credentials that are provided
      // Empty string means "clear this credential"
      for (const [key, value] of Object.entries(body.credentials)) {
        if (value === "") {
          // Clear the credential
          delete newCredentials[key as keyof StoredCredentials]
        } else if (value) {
          // Encrypt and store
          newCredentials[key as keyof StoredCredentials] = encrypt(value)
        }
      }
    }

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: newSettings as Prisma.InputJsonValue,
        credentials: newCredentials as Prisma.InputJsonValue,
      },
    })

    // Return updated state (same format as GET)
    const response: SettingsResponse = {
      settings: {
        defaultAgent: newSettings.defaultAgent ?? "opencode",
        defaultModel: newSettings.defaultModel ?? "opencode/big-pickle",
        theme: newSettings.theme ?? "system",
      },
      credentialFlags: {
        hasAnthropicApiKey: !!newCredentials.anthropicApiKey,
        hasAnthropicAuthToken: !!newCredentials.anthropicAuthToken,
        hasOpenaiApiKey: !!newCredentials.openaiApiKey,
        hasOpencodeApiKey: !!newCredentials.opencodeApiKey,
        hasGeminiApiKey: !!newCredentials.geminiApiKey,
      },
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
