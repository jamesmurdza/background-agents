/**
 * Server-only credential flag resolution.
 * Must never be imported from client code.
 */

import { prisma } from "@/lib/db/prisma"
import { isSharedPoolAvailable } from "@/lib/claude-credentials"
import { decryptUserCredentials } from "@/lib/db/api-helpers"
import { microToUsd } from "@/lib/server/credits"
import { flagsFromCredentials, CREDENTIAL_KEYS, type CredentialFlags } from "@/lib/credentials"
import { hasSharedKey, SHARED_KEY_POOLS } from "@/lib/server/shared-key-pools"
import { SHARED_POOL_AGENTS } from "@/lib/server/shared-pool"
import { agentUsesSharedPool } from "@background-agents/common"

export interface EffectiveFlags {
  flags: CredentialFlags
  /**
   * Purchased credits in USD, or null when the balance does not gate this user
   * at all — an account running entirely on its own keys. Null is the "do not warn about this" signal the UI reads, and is
   * deliberately distinct from `0`: see creditTier in lib/server/credits.
   *
   * Set under exactly the same condition as `SHARED_BALANCE_EXHAUSTED` below,
   * so the number and the boolean can never describe different users.
   */
  creditBalanceUsd: number | null
  /**
   * Why `creditBalanceUsd` looks the way it does, so a UI can say something
   * truthful instead of guessing at a null:
   *
   * - "balance" — a real number, which may be zero or negative
   * - "none"    — own keys everywhere, so the balance doesn't apply
   *
   * Without this, both arrive as null and the only safe thing to render
   * is nothing.
   */
  creditsMode: CreditsMode
  /**
   * The user's purchased credit balance, always — including when credits don't
   * gate them at all. Unlike `creditBalanceUsd` this is never null for a
   * signed-in user, because it answers "how much is in the account" rather
   * than "should we warn them". The header shows this one.
   */
  availableCreditsUsd: number
}

/** See {@link EffectiveCredentialFlags.creditsMode}. */
export type CreditsMode = "balance" | "none"

/**
 * Build effective credential flags for a user, including the daily Claude limit status.
 *
 * This is the single entry point for server-side flag resolution. It combines:
 * - Stored credentials
 * - Shared pool availability
 * - Daily limit check (only for free users using shared credentials)
 *
 * The resulting flags can be passed directly to getDefaultAgent/hasCredentialsForModel.
 */
/**
 * Server-config-only credential flags — the shared pools available to everyone,
 * derived purely from server env / rotating credential state with no user
 * context. Safe to expose to logged-out visitors so the agent picker can show
 * the shared-pool "ready" dots (Claude Code, Gemini, OpenCode) before sign-in.
 *
 * Only booleans about server configuration are returned — never key values.
 * getEffectiveCredentialFlags layers the user's own stored credentials and the
 * daily-limit state on top of these same signals for an authenticated user.
 */
export async function getSharedPoolFlags(): Promise<CredentialFlags> {
  const flags: CredentialFlags = {}

  // Server env keys back the shared OpenCode / Gemini pools. Mark both the
  // presence flag (so hasCredentialsForModel treats the provider as available)
  // and the `_SHARED` origin flag (so the UI knows it isn't a user-owned key).
  if (hasSharedKey(SHARED_KEY_POOLS.opencode)) {
    flags.OPENCODE_API_KEY = true
    flags.OPENCODE_API_KEY_SHARED = true
  }
  if (hasSharedKey(SHARED_KEY_POOLS.gemini)) {
    flags.GEMINI_API_KEY = true
    flags.GEMINI_API_KEY_SHARED = true
  }
  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  return flags
}

export async function getEffectiveCredentialFlags(userId: string): Promise<EffectiveFlags> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credentials: true, creditBalanceMicroUsd: true },
  })

  // Decrypt stored credentials (only those the user has saved)
  const storedCreds = decryptUserCredentials(
    user?.credentials as Record<string, unknown> | null
  )

  // Build the full credentials map by falling back to process.env for any
  // missing values. This map is used elsewhere (not for origin detection).
  const decryptedCreds = { ...storedCreds }
  for (const { id } of CREDENTIAL_KEYS) {
    if (!decryptedCreds[id] && process.env[id]) {
      decryptedCreds[id] = process.env[id]
    }
  }

  // Build flags from the stored (user-provided) credentials so we can
  // distinguish between user-owned keys and server-shared env keys.
  const flags = flagsFromCredentials(storedCreds)

  // Special-case: mark whether OPENCODE_API_KEY comes from the user's stored
  // credentials (user-owned) or only from the server environment (shared).
  const opencodeFromDb = !!storedCreds.OPENCODE_API_KEY
  const opencodeFromEnv = !opencodeFromDb && hasSharedKey(SHARED_KEY_POOLS.opencode)
  flags.OPENCODE_API_KEY_USER = opencodeFromDb
  flags.OPENCODE_API_KEY_SHARED = opencodeFromEnv
  // Preserve the conventional boolean presence flag for callers that expect it
  flags.OPENCODE_API_KEY = opencodeFromDb || opencodeFromEnv

  // Same for GEMINI_API_KEY: a server env key (shared pool) should make Gemini
  // show as available in the UI, not prompt for a key. Pool origin (shared vs
  // user) is still resolved separately from stored creds, so flagging the env
  // key here doesn't make it count as user-owned.
  const geminiFromDb = !!storedCreds.GEMINI_API_KEY
  const geminiFromEnv = !geminiFromDb && hasSharedKey(SHARED_KEY_POOLS.gemini)
  flags.GEMINI_API_KEY_USER = geminiFromDb
  flags.GEMINI_API_KEY_SHARED = geminiFromEnv
  flags.GEMINI_API_KEY = geminiFromDb || geminiFromEnv

  if (await isSharedPoolAvailable()) {
    flags.CLAUDE_SHARED_POOL_AVAILABLE = true
  }

  // The balance is pooled across every shared pool, so track it for anyone who
  // draws on at least one of them. A user with their own key everywhere spends
  // nothing and gets no balance display.
  const usesSharedPool = SHARED_POOL_AGENTS.some((agent) =>
    agentUsesSharedPool(agent, flags)
  )
  const credits = user?.creditBalanceMicroUsd ?? 0n

  // Readiness for the agent picker: the exact negation of the send gate in
  // lib/db/usage-limit, so the picker never offers a model the server refuses.
  if (usesSharedPool) {
    flags.SHARED_BALANCE_EXHAUSTED = credits <= 0n
  }

  return {
    flags,
    creditBalanceUsd: usesSharedPool ? microToUsd(credits) : null,
    creditsMode: usesSharedPool ? "balance" : "none",
    availableCreditsUsd: microToUsd(credits),
  }
}
