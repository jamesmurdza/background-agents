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
  isClientWritableCredential,
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
import { withUserLock } from "@/lib/server/codex-credentials"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

interface SettingsResponse {
  settings: Settings
  credentialFlags: CredentialFlags
  /** The user's custom endpoints, headers decrypted for the owner to edit. */
  customEndpoints: CustomEndpoint[]
  /** Whether user is a pro subscriber */
  planIsPro: boolean
  /**
   * Purchased credits in USD, or null when the balance doesn't gate this user
   * (unlimited plan, or own keys everywhere). Carried on this response rather
   * than fetched separately because getEffectiveCredentialFlags already reads
   * the balance to set SHARED_BALANCE_EXHAUSTED — the composer's low-credit
   * warning costs no extra query and can never disagree with the picker's dot.
   * The Credits tab still uses /api/user/credits, which also returns history.
   */
  creditBalanceUsd: number | null
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
    elizaEnabled: s.elizaEnabled ?? DEFAULT_SETTINGS.elizaEnabled,
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
      planIsPro: effective.isPro,
      creditBalanceUsd: effective.creditBalanceUsd,
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

    // Custom endpoints: validate up front. This doesn't need the user row, so
    // it can fail fast before we ever take the row lock below.
    let newEndpoints: Prisma.InputJsonValue | undefined
    if (body.customEndpoints !== undefined) {
      const incoming = readIncomingEndpoints(body.customEndpoints)
      const invalid = validateEndpoints(incoming)
      if (invalid) return badRequest(invalid.message)
      newEndpoints = encryptEndpointsForStorage(incoming) as unknown as Prisma.InputJsonValue
    }

    // Read-modify-write User.credentials under the SAME transaction-scoped row
    // lock a Codex refresh takes (see lib/server/codex-credentials.ts). Without
    // this lock, a settings PATCH that only touches unrelated fields (theme,
    // notifications, an unrelated API key) can still read a pre-refresh copy
    // of `credentials`, then write it back over a refresh that landed in
    // between — silently reverting a just-rotated Codex refresh token back to
    // one OpenAI has already invalidated.
    const { newSettings, priorCustomEndpoints } = await withUserLock(
      userId,
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { settings: true, credentials: true, customEndpoints: true },
        })

        const newSettings: Settings = body.settings
          ? { ...readSettings(user?.settings), ...body.settings }
          : readSettings(user?.settings)

        // Normalize legacy keys to the new shape on read; this auto-upgrades
        // the row's storage format on the next write.
        const newCredentials = normalizeStoredCredentials(
          user?.credentials as Record<string, unknown> | null
        )

        if (body.credentials) {
          for (const [key, value] of Object.entries(body.credentials)) {
            if (!isCredentialId(key)) continue
            // Server-managed credentials are never accepted from the client.
            if (!isClientWritableCredential(key)) continue
            // The literal "***" is the UI mask for an existing key — never a
            // real credential value. Reject defensively in case a stale
            // client sends it.
            if (value === "***") continue
            if (value === "" || value === undefined) {
              delete newCredentials[key]
            } else if (typeof value === "string") {
              newCredentials[key] = encrypt(value)
            }
          }
        }

        await tx.user.update({
          where: { id: userId },
          data: {
            settings: newSettings as unknown as Prisma.InputJsonValue,
            credentials: newCredentials as unknown as Prisma.InputJsonValue,
            ...(newEndpoints !== undefined ? { customEndpoints: newEndpoints } : {}),
          },
        })

        return {
          newSettings,
          priorCustomEndpoints: user?.customEndpoints,
        }
      },
      // Prisma's default interactive-transaction timeout is 5s, but a Codex
      // refresh holds this same row lock under a 15s budget (see
      // lib/server/codex-credentials.ts) while it waits on OpenAI. Left at the
      // default, a settings save that lands during a slow refresh would wait
      // out the 5s and 500 the user for something entirely unrelated to Codex.
      // Sit above the refresh path's worst case instead.
      { timeout: 20000 }
    )

    // After updating credentials, recompute effective flags
    const effective = await (await import("@/lib/server/credential-flags")).getEffectiveCredentialFlags(userId)

    const response: SettingsResponse = {
      settings: newSettings,
      credentialFlags: effective.flags,
      customEndpoints: decryptUserEndpoints(
        newEndpoints ?? (priorCustomEndpoints as unknown)
      ),
      planIsPro: effective.isPro,
      creditBalanceUsd: effective.creditBalanceUsd,
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
