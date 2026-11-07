/**
 * A user's own Claude subscription, refreshed by the server (server-only).
 *
 * The credentials a user pastes (~/.claude/.credentials.json) stay here: a
 * run never gets them, only an access token, fetched by its token runner from
 * the claude-token route the way a shared Claude run's is (and behind a
 * Daytona secret, a placeholder for it). So no sandbox ever holds the refresh
 * token, and the rotated one is saved instead of lost.
 *
 * Refresh tokens rotate, so a refresh holds the same user-row lock as every
 * other write to User.credentials (withUserLock). A refresh also signs out
 * whatever else used that refresh token, e.g. the machine it was pasted from.
 */

import "server-only"
import type { CredentialId } from "@background-agents/common"
import type { Prisma } from "@prisma/client"

import { normalizeStoredCredentials } from "@/lib/credentials"
import { decrypt, encrypt } from "@/lib/db/encryption"
import { prisma } from "@/lib/db/prisma"
import {
  ClaudeRefreshRejectedError,
  claudeTokenExpiring,
  parseClaudeCredentials,
  refreshClaudeOAuth,
} from "@/lib/server/claude-oauth"
import { withUserLock } from "@/lib/server/codex-credentials"
import { pruneClaudeOwnSecrets } from "@/lib/server/subscription-secrets"
import type { ClaudeOAuthCredentials } from "@background-agents/claude-credentials"

const CREDENTIAL_KEY: CredentialId = "CLAUDE_CODE_CREDENTIALS"

/**
 * Refresh when less than this is left: a run may go a while before asking
 * for a token again, and asks again only once its own has failed.
 */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000

/** The stored login is unusable (refresh token dead, or none and the token expired): paste a new one. */
export class OwnClaudeCredentialsExpiredError extends Error {
  constructor() {
    super("Your Claude subscription login has expired. Paste fresh credentials in Settings.")
    this.name = "OwnClaudeCredentialsExpiredError"
  }
}

/** The token couldn't be refreshed just now; worth retrying. */
export class OwnClaudeCredentialsUnavailableError extends Error {
  constructor() {
    super("Couldn't refresh your Claude subscription. Please try again.")
    this.name = "OwnClaudeCredentialsUnavailableError"
  }
}

async function readTx(tx: Prisma.TransactionClient, userId: string): Promise<ClaudeOAuthCredentials | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const raw = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)[CREDENTIAL_KEY]
  return raw ? parseClaudeCredentials(decrypt(raw)) : null
}

async function writeTx(tx: Prisma.TransactionClient, userId: string, creds: ClaudeOAuthCredentials): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
  stored[CREDENTIAL_KEY] = encrypt(JSON.stringify(creds))
  await tx.user.update({ where: { id: userId }, data: { credentials: stored as never } })
}

/**
 * `userId`'s Claude subscription access token, refreshed first when it
 * expires within {@link REFRESH_MARGIN_MS}. Throws
 * {@link OwnClaudeCredentialsExpiredError} when only a new login helps (or
 * there is no usable login), {@link OwnClaudeCredentialsUnavailableError}
 * when a refresh failed and the token can't be used meanwhile.
 */
export async function getUserClaudeAccessToken(userId: string): Promise<string> {
  const current = await prisma.$transaction((tx) => readTx(tx, userId))
  if (!current) throw new OwnClaudeCredentialsExpiredError()
  if (!claudeTokenExpiring(current, REFRESH_MARGIN_MS)) return current.claudeAiOauth.accessToken

  type Outcome = { token: string; refreshed?: boolean } | { error: Error }
  const result = await withUserLock<Outcome>(
    userId,
    async (tx) => {
      // Re-read inside the lock: a racing run may have just refreshed it.
      const creds = await readTx(tx, userId)
      if (!creds) return { error: new OwnClaudeCredentialsExpiredError() }
      if (!claudeTokenExpiring(creds, REFRESH_MARGIN_MS)) return { token: creds.claudeAiOauth.accessToken }
      let next: ClaudeOAuthCredentials
      try {
        next = await refreshClaudeOAuth(creds)
      } catch (err) {
        const usable = !claudeTokenExpiring(creds, 0)
        if (err instanceof ClaudeRefreshRejectedError) {
          return usable ? { token: creds.claudeAiOauth.accessToken } : { error: new OwnClaudeCredentialsExpiredError() }
        }
        console.error("[user-claude-credentials] transient refresh failure:", err instanceof Error ? err.message : "unknown")
        return usable ? { token: creds.claudeAiOauth.accessToken } : { error: new OwnClaudeCredentialsUnavailableError() }
      }
      // Persist before anything else: the old refresh token is dead now. A
      // failure here propagates rather than passing as transient.
      await writeTx(tx, userId, next)
      return { token: next.claudeAiOauth.accessToken, refreshed: true }
    },
    // The refresh is an outbound call (bounded at 15s) made under the lock.
    { timeout: 30_000 }
  )
  if ("error" in result) throw result.error
  if (result.refreshed) await pruneClaudeOwnSecrets(userId)
  return result.token
}
