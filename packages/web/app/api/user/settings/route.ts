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
  type CredentialId,
  type CredentialFlags,
  type Credentials,
} from "@/lib/credentials"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"
import type { EffectiveFlags } from "@/lib/server/credential-flags"

interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
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

/** Combine resolved settings with effective credential flags into the API response. */
function buildSettingsResponse(settings: Settings, effective: EffectiveFlags): SettingsResponse {
  return {
    settings,
    credentialFlags: effective.flags,
    claudeLimitResetAt: effective.limitResetAt?.toISOString() ?? null,
    claudeLimitRemaining: effective.limitRemaining,
    claudeLimitUsed: effective.limitUsed,
    claudeLimitTotal: effective.limitTotal,
    claudeIsPro: effective.isPro,
    claudeIsWeekly: effective.isWeekly,
  }
}

function readSettings(raw: unknown): Settings {
  const s = (raw as Partial<Settings> | null) ?? {}
  return {
    defaultAgent: s.defaultAgent ?? null,
    defaultModel: s.defaultModel ?? null,
    theme: s.theme ?? DEFAULT_SETTINGS.theme,
    rapidFireMode: s.rapidFireMode ?? DEFAULT_SETTINGS.rapidFireMode,
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
      select: { settings: true },
    })

    const effective = await (await import("@/lib/server/credential-flags")).getEffectiveCredentialFlags(userId)

    return Response.json(buildSettingsResponse(readSettings(user?.settings), effective))
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true, credentials: true },
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

    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: newSettings as unknown as Prisma.InputJsonValue,
        credentials: newCredentials as unknown as Prisma.InputJsonValue,
      },
    })

    // After updating credentials, recompute effective flags
    const effective = await (await import("@/lib/server/credential-flags")).getEffectiveCredentialFlags(userId)

    return Response.json(buildSettingsResponse(newSettings, effective))
  } catch (error) {
    return internalError(error)
  }
}
