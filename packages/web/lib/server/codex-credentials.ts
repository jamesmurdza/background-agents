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
import type { Prisma } from "@prisma/client"
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

async function readCodexCredentialTx(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<CodexStoredCredential | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
  const raw = stored[CREDENTIAL_KEY]
  return raw ? parseCodexCredential(decrypt(raw)) : null
}

async function writeCodexCredentialTx(
  tx: Prisma.TransactionClient,
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

/**
 * Take a transaction-scoped lock on the user's row. Everything that reads a
 * refresh token with intent to spend it — or otherwise mutates
 * User.credentials — must hold this first: a rotation lost to a race is the
 * one unrecoverable failure in this design.
 */
async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
}

/**
 * Run `fn` inside a transaction that first takes the user's row lock.
 *
 * Exported so callers OUTSIDE this module that also read-modify-write
 * User.credentials (e.g. the settings PATCH route) take the exact same lock
 * instead of racing it from outside — a plain `findUnique` + `update` on the
 * same column, done without this lock, can commit a stale copy of the
 * credentials blob on top of a rotation that happened in between.
 */
export async function withUserLock<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    return fn(tx)
  }, options)
}

/** Persist a credential (used by the connect flow and by refreshes). */
export async function storeCodexCredential(
  userId: string,
  cred: CodexStoredCredential
): Promise<void> {
  await withUserLock(userId, (tx) => writeCodexCredentialTx(tx, userId, cred))
}

/**
 * Resolve an auth.json ready to inject into a sandbox, refreshing first if the
 * credential has reached its refresh window. Returns null when the user has no
 * usable subscription, so callers fall through to OPENAI_API_KEY.
 */
export async function resolveCodexAuthJson(userId: string): Promise<string | null> {
  const { cred } = await withFreshCredential(userId)
  if (!cred) return null
  return buildCodexAuthJson(cred, Date.now())
}

interface FreshCredentialResult {
  cred: CodexStoredCredential | null
  /**
   * True when a refresh attempt failed with something other than a terminal
   * CodexReconnectRequiredError (e.g. OpenAI 503s, a timed-out fetch). Lets
   * refreshCodexCredentialForUser tell "OpenAI is having a bad day" apart
   * from "nothing was due" or "genuinely needs reconnect" in cron reporting.
   */
  transientFailure: boolean
}

/**
 * The shared read-lock-refresh-write core. Returns the credential to use
 * (null when there is none or it needs reconnecting) plus whether a
 * transient failure occurred along the way.
 */
async function withFreshCredential(userId: string): Promise<FreshCredentialResult> {
  return withUserLock(
    userId,
    async (tx) => {
      // Re-read INSIDE the lock: a racing caller may have just refreshed, in
      // which case this sees the rotated token and skips.
      const cred = await readCodexCredentialTx(tx, userId)
      if (!cred) return { cred: null, transientFailure: false }
      if (cred.status === "needs_reconnect") return { cred: null, transientFailure: false }
      if (!needsRefresh(cred, Date.now())) return { cred, transientFailure: false }

      // Only the network call is guarded here. Once refreshCodexTokens
      // resolves, OpenAI has already rotated the token server-side — a
      // failure to persist it past this point is NOT a transient refresh
      // failure (mislabeling it as one would quietly keep serving the
      // now-stale credential while masking that the rotation was lost). Let
      // that failure propagate instead of swallowing it.
      let res
      try {
        res = await refreshCodexTokens(cred.refresh_token)
      } catch (err) {
        if (err instanceof CodexReconnectRequiredError) {
          // Terminal. Never retry a dead refresh token — that is how other
          // Codex integrations leave users permanently stuck.
          await writeCodexCredentialTx(tx, userId, { ...cred, status: "needs_reconnect" })
          return { cred: null, transientFailure: false }
        }
        console.error("[codex-credentials] transient refresh failure:", (err as Error).message)
        // The stored access token has ~24h of life left at this point
        // (that's what the refresh window means), so the run can still
        // proceed.
        const stillValid = Date.now() / 1000 < cred.expires_at
        return { cred: stillValid ? cred : null, transientFailure: true }
      }

      const next = credentialFromTokenResponse(res, cred.account_id, Date.now())
      await writeCodexCredentialTx(tx, userId, next)
      return { cred: next, transientFailure: false }
    },
    // The refresh call is an outbound fetch to OpenAI made while holding the
    // row lock. Prisma's default interactive-transaction timeout (5s) is
    // tight for a network round trip; a timeout here would abort the
    // transaction AFTER OpenAI has already rotated the token but before we
    // persist it — the one unrecoverable failure this module exists to
    // avoid. Give it more room. (refreshCodexTokens also bounds its own
    // fetch to 8s, so a hang there surfaces as a transient failure well
    // before this fires.)
    { timeout: 15000 }
  )
}

/** Cron entry point: refresh one user's credential if it is due. */
export async function refreshCodexCredentialForUser(
  userId: string
): Promise<"refreshed" | "skipped" | "needs_reconnect" | "transient_failure" | "absent"> {
  const before = await readCodexCredential(userId)
  if (!before) return "absent"
  if (before.status === "needs_reconnect") return "needs_reconnect"
  if (!needsRefresh(before, Date.now())) return "skipped"

  const { cred: after, transientFailure } = await withFreshCredential(userId)
  if (!after) return "needs_reconnect"
  if (transientFailure) return "transient_failure"
  return after.refresh_token === before.refresh_token ? "skipped" : "refreshed"
}

/** Drop the credential and revoke the grant with OpenAI (best effort). */
export async function disconnectCodex(userId: string): Promise<void> {
  // Read-then-delete happens inside the SAME lock, so a refresh racing this
  // call can't leave us revoking a token that isn't the one actually stored
  // at delete time.
  const cred = await withUserLock(userId, async (tx) => {
    const existing = await readCodexCredentialTx(tx, userId)
    await writeCodexCredentialTx(tx, userId, null)
    return existing
  })
  if (cred) {
    const revoked = await revokeCodexToken(cred.refresh_token)
    if (!revoked) console.warn("[codex-credentials] revocation failed; grant will age out")
  }
}
