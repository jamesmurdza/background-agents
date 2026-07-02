import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { encrypt } from "@/lib/db/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  isCredentialId,
  normalizeStoredCredentials,
  type CredentialFlags,
  type Credentials,
} from "@/lib/credentials"
import type { CustomEndpoint } from "@background-agents/common"
import {
  decryptUserEndpoints,
  encryptEndpointsForStorage,
  readIncomingEndpoints,
  validateEndpoints,
} from "@/lib/server/custom-endpoints"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
  /** The user's custom endpoints, headers decrypted for the owner to edit. */
  customEndpoints: CustomEndpoint[]
  /** ISO timestamp when the daily Claude limit resets, or null if not limited */
  claudeLimitResetAt: string | null
  /** Remaining Claude Code messages today, or null if not applicable */
  claudeLimitRemaining: number | null
  /** Number of shared Claude messages used in current period, or null if not using shared pool */
  claudeLimitUsed: number | null
  /** Daily limit (10 for free users), or null if pro/unlimited */
  claudeLimitTotal: number | null
  /** Whether user is a pro subscriber */
  claudeIsPro: boolean
  /** Whether usage is tracked weekly (pro) vs daily (free) */
  claudeIsWeekly: boolean
}

function readSettings(raw: unknown): Settings {
  const s = (raw as Partial<Settings> | null) ?? {}
  return {
    defaultAgent: s.defaultAgent ?? null,
    defaultModel: s.defaultModel ?? null,
    theme: s.theme ?? DEFAULT_SETTINGS.theme,
    enablePrepushHooks: s.enablePrepushHooks ?? DEFAULT_SETTINGS.enablePrepushHooks,
    notifyOnAgentFinished: s.notifyOnAgentFinished ?? DEFAULT_SETTINGS.notifyOnAgentFinished,
    notifyOnAgentCommitted: s.notifyOnAgentCommitted ?? DEFAULT_SETTINGS.notifyOnAgentCommitted,
    notificationSound: s.notificationSound ?? DEFAULT_SETTINGS.notificationSound,
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
      select: { settings: true, customEndpoints: true },
    })

    const effective = await (await import("@/lib/server/credential-flags")).getEffectiveCredentialFlags(userId)

    const response: SettingsResponse = {
      settings: readSettings(user?.settings),
      credentialFlags: effective.flags,
      customEndpoints: decryptUserEndpoints(user?.customEndpoints),
      claudeLimitResetAt: effective.limitResetAt?.toISOString() ?? null,
      claudeLimitRemaining: effective.limitRemaining,
      claudeLimitUsed: effective.limitUsed,
      claudeLimitTotal: effective.limitTotal,
      claudeIsPro: effective.isPro,
      claudeIsWeekly: effective.isWeekly,
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
  settings?: Partial<Settings>
  credentials?: Credentials
  customEndpoints?: unknown
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  try {
    const body: PatchBody = await req.json()

    if (!body.settings && !body.credentials && body.customEndpoints === undefined) {
      return badRequest("Must provide settings, credentials, or custom endpoints to update")
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true, credentials: true, customEndpoints: true },
    })

    const newSettings: Settings = body.settings
      ? { ...readSettings(user?.settings), ...body.settings }
      : readSettings(user?.settings)

    // Normalize legacy keys to the new shape on read; this auto-upgrades the
    // row's storage format on the next write.
    const newCredentials = normalizeStoredCredentials(
      user?.credentials as Record<string, unknown> | null
    )

    if (body.credentials) {
      for (const [key, value] of Object.entries(body.credentials)) {
        if (!isCredentialId(key)) continue
        // The literal "***" is the UI mask for an existing key — never a real
        // credential value. Reject defensively in case a stale client sends it.
        if (value === "***") continue
        if (value === "" || value === undefined) {
          delete newCredentials[key]
        } else if (typeof value === "string") {
          newCredentials[key] = encrypt(value)
        }
      }
    }

    // Custom endpoints: validate, encrypt headers, and replace the stored list
    // wholesale (the client always sends the full list it wants persisted).
    let newEndpoints: Prisma.InputJsonValue | undefined
    if (body.customEndpoints !== undefined) {
      const incoming = readIncomingEndpoints(body.customEndpoints)
      const invalid = validateEndpoints(incoming)
      if (invalid) return badRequest(invalid.message)
      newEndpoints = encryptEndpointsForStorage(incoming) as unknown as Prisma.InputJsonValue
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: newSettings as unknown as Prisma.InputJsonValue,
        credentials: newCredentials as unknown as Prisma.InputJsonValue,
        ...(newEndpoints !== undefined ? { customEndpoints: newEndpoints } : {}),
      },
    })

    // After updating credentials, recompute effective flags
    const effective = await (await import("@/lib/server/credential-flags")).getEffectiveCredentialFlags(userId)

    const response: SettingsResponse = {
      settings: newSettings,
      credentialFlags: effective.flags,
      customEndpoints: decryptUserEndpoints(
        newEndpoints ?? (user?.customEndpoints as unknown)
      ),
      claudeLimitResetAt: effective.limitResetAt?.toISOString() ?? null,
      claudeLimitRemaining: effective.limitRemaining,
      claudeLimitUsed: effective.limitUsed,
      claudeLimitTotal: effective.limitTotal,
      claudeIsPro: effective.isPro,
      claudeIsWeekly: effective.isWeekly,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
