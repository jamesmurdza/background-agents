/**
 * Server-owned lifecycle for the Codex ChatGPT subscription credential.
 *
 * The invariant this module exists to hold: the real refresh token lives here
 * and nowhere else. Sandboxes get an access token plus a placeholder, so no
 * run can rotate the user's grant and sign them out of their own machine.
 *
 * Refreshes are single-flight per user under a transaction-scoped row lock.
 * Production runs behind a transaction pooler, where session-level advisory
 * locks do not hold (see packages/web/README.md).
 */
import "server-only"
import { prisma } from "@/lib/db/prisma"
import { encrypt, decrypt } from "@/lib/db/encryption"
import { normalizeStoredCredentials } from "@/lib/credentials"
import {
  parseCodexCredential,
  credentialFromTokenResponse,
  needsRefresh,
  buildCodexAuthJson,
  type CodexStoredCredential,
} from "@/lib/codex-credentials"
import { refreshCodexTokens, revokeCodexToken, CodexReconnectRequiredError } from "./codex-oauth"
import type { CredentialId } from "@background-agents/common"

// Typed as CredentialId, not string: normalizeStoredCredentials returns a
// Record keyed by CredentialId, and a widened string index will not compile.
const CREDENTIAL_KEY: CredentialId = "CODEX_CREDENTIALS"

/** Read + decrypt the stored credential outside any transaction. */
export async function readCodexCredential(userId: string): Promise<CodexStoredCredential | null> {
  return prisma.$transaction(async (tx) => readCodexCredentialTx(tx, userId))
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

async function readCodexCredentialTx(tx: Tx, userId: string): Promise<CodexStoredCredential | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
  const raw = stored[CREDENTIAL_KEY]
  return raw ? parseCodexCredential(decrypt(raw)) : null
}

async function writeCodexCredentialTx(
  tx: Tx,
  userId: string,
  cred: CodexStoredCredential | null
): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
  if (cred) {
    stored[CREDENTIAL_KEY] = encrypt(JSON.stringify(cred))
  } else {
    delete stored[CREDENTIAL_KEY]
  }
  await tx.user.update({
    where: { id: userId },
    data: { credentials: stored as never },
  })
}

/** Persist a credential (used by the connect flow and by refreshes). */
export async function storeCodexCredential(
  userId: string,
  cred: CodexStoredCredential
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    await writeCodexCredentialTx(tx, userId, cred)
  })
}

/**
 * Take a transaction-scoped lock on the user's row. Everything that reads a
 * refresh token with intent to spend it must hold this first — a rotation lost
 * to a race is the one unrecoverable failure in this design.
 */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
}

/**
 * Resolve an auth.json ready to inject into a sandbox, refreshing first if the
 * credential has reached its refresh window. Returns null when the user has no
 * usable subscription, so callers fall through to OPENAI_API_KEY.
 */
export async function resolveCodexAuthJson(userId: string): Promise<string | null> {
  const outcome = await withFreshCredential(userId)
  if (!outcome) return null
  return buildCodexAuthJson(outcome, Date.now())
}

/**
 * The shared read-lock-refresh-write core. Returns the credential to use, or
 * null when there is none or it needs reconnecting.
 */
async function withFreshCredential(userId: string): Promise<CodexStoredCredential | null> {
  return prisma.$transaction(
    async (tx) => {
      await lockUser(tx, userId)

      // Re-read INSIDE the lock: a racing caller may have just refreshed, in
      // which case this sees the rotated token and skips.
      const cred = await readCodexCredentialTx(tx, userId)
      if (!cred) return null
      if (cred.status === "needs_reconnect") return null
      if (!needsRefresh(cred, Date.now())) return cred

      // Only the network call is guarded here. Once refreshCodexTokens
      // resolves, OpenAI has already rotated the token server-side — a
      // failure to persist it past this point is NOT a transient refresh
      // failure (the old code path would mislabel it as one and quietly
      // keep serving the now-stale credential). Let that failure propagate
      // instead of swallowing it.
      let res
      try {
        res = await refreshCodexTokens(cred.refresh_token)
      } catch (err) {
        if (err instanceof CodexReconnectRequiredError) {
          // Terminal. Never retry a dead refresh token — that is how other
          // Codex integrations leave users permanently stuck.
          await writeCodexCredentialTx(tx, userId, { ...cred, status: "needs_reconnect" })
          return null
        }
        console.error("[codex-credentials] transient refresh failure:", (err as Error).message)
        // The stored access token has ~24h of life left at this point
        // (that's what the refresh window means), so the run can still
        // proceed.
        return Date.now() / 1000 < cred.expires_at ? cred : null
      }

      const next = credentialFromTokenResponse(res, cred.account_id, Date.now())
      await writeCodexCredentialTx(tx, userId, next)
      return next
    },
    // The refresh call is an outbound fetch to OpenAI made while holding the
    // row lock. Prisma's default interactive-transaction timeout (5s) is
    // tight for a network round trip; a timeout here would abort the
    // transaction AFTER OpenAI has already rotated the token but before we
    // persist it — the one unrecoverable failure this module exists to
    // avoid. Give it more room.
    { timeout: 15000 }
  )
}

/** Cron entry point: refresh one user's credential if it is due. */
export async function refreshCodexCredentialForUser(
  userId: string
): Promise<"refreshed" | "skipped" | "needs_reconnect" | "absent"> {
  const before = await readCodexCredential(userId)
  if (!before) return "absent"
  if (before.status === "needs_reconnect") return "needs_reconnect"
  if (!needsRefresh(before, Date.now())) return "skipped"

  const after = await withFreshCredential(userId)
  if (!after) return "needs_reconnect"
  return after.refresh_token === before.refresh_token ? "skipped" : "refreshed"
}

/** Drop the credential and revoke the grant with OpenAI (best effort). */
export async function disconnectCodex(userId: string): Promise<void> {
  const cred = await readCodexCredential(userId)
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    await writeCodexCredentialTx(tx, userId, null)
  })
  if (cred) {
    const revoked = await revokeCodexToken(cred.refresh_token)
    if (!revoked) console.warn("[codex-credentials] revocation failed; grant will age out")
  }
}
