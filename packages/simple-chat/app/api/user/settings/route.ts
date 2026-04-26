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
import {
  CREDENTIAL_KEYS,
  isCredentialId,
  normalizeStoredCredentials,
  type CredentialId,
  type CredentialFlags,
  type Credentials,
} from "@/lib/credentials"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
}

function readSettings(raw: unknown): Settings {
  const s = (raw as Partial<Settings> | null) ?? {}
  return {
    defaultAgent: s.defaultAgent ?? null,
    defaultModel: s.defaultModel ?? null,
    theme: s.theme ?? DEFAULT_SETTINGS.theme,
  }
}

async function buildFlags(stored: Record<CredentialId, string>): Promise<CredentialFlags> {
  const flags: CredentialFlags = {}
  for (const { id } of CREDENTIAL_KEYS) {
    const enc = stored[id]
    flags[id] = !!(enc && decrypt(enc))
  }
  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }
  return flags
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

    const stored = normalizeStoredCredentials(
      user?.credentials as Record<string, unknown> | null
    )

    const response: SettingsResponse = {
      settings: readSettings(user?.settings),
      credentialFlags: await buildFlags(stored),
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

    const response: SettingsResponse = {
      settings: newSettings,
      credentialFlags: await buildFlags(newCredentials),
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
