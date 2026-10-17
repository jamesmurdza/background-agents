/** Server-side GitHub OAuth token resolution for API, git, and scheduled runs. */
import "server-only"
import { prisma } from "@/lib/db/prisma"

const REFRESH_EARLY_SECONDS = 5 * 60

/** A transient refresh failure; callers should retry, not ask the user to reconnect. */
export class GitHubTokenRefreshError extends Error {
  constructor() {
    super("GitHub authorization is temporarily unavailable")
    this.name = "GitHubTokenRefreshError"
  }
}

class GitHubReauthorizationRequiredError extends Error {}

interface RefreshedToken {
  access_token: string
  refresh_token: string
  expires_in: number
  refresh_token_expires_in: number
}

async function exchangeRefreshToken(refreshToken: string): Promise<RefreshedToken> {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new GitHubTokenRefreshError()

  let response: Response
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new GitHubTokenRefreshError()
  }

  let body: unknown
  try {
    // Do not propagate SyntaxError: it can include a fragment of a token-bearing response.
    body = JSON.parse(await response.text())
  } catch {
    throw new GitHubTokenRefreshError()
  }
  if (!body || typeof body !== "object") throw new GitHubTokenRefreshError()

  const data = body as Partial<RefreshedToken> & { error?: unknown }
  if (data.error === "bad_refresh_token" || data.error === "invalid_grant") {
    throw new GitHubReauthorizationRequiredError()
  }
  if (
    !response.ok ||
    typeof data.access_token !== "string" || !data.access_token ||
    typeof data.refresh_token !== "string" || !data.refresh_token ||
    !Number.isInteger(data.expires_in) || (data.expires_in ?? 0) <= 0 ||
    !Number.isInteger(data.refresh_token_expires_in) ||
    (data.refresh_token_expires_in ?? 0) <= 0
  ) {
    throw new GitHubTokenRefreshError()
  }
  return data as RefreshedToken
}

/**
 * Return a usable token, refreshing expiring grants under an Account row lock.
 * Non-expiring OAuth grants have no `expires_at` and remain unchanged.
 * GitHub rotates both tokens on refresh, so the lock spans read, exchange, and write.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { id: true, access_token: true, expires_at: true },
  })
  if (!account?.access_token) return null
  if (account.expires_at === null || account.expires_at > Date.now() / 1000 + REFRESH_EARLY_SECONDS) {
    return account.access_token
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`
      const locked = await tx.account.findUnique({
        where: { id: account.id },
        select: { access_token: true, refresh_token: true, expires_at: true },
      })
      if (!locked?.access_token) return null
      if (locked.expires_at === null || locked.expires_at > Date.now() / 1000 + REFRESH_EARLY_SECONDS) {
        return locked.access_token
      }
      if (!locked.refresh_token) return null

      try {
        const fresh = await exchangeRefreshToken(locked.refresh_token)
        await tx.account.update({
          where: { id: account.id },
          data: {
            access_token: fresh.access_token,
            refresh_token: fresh.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + fresh.expires_in,
            refresh_token_expires_in: fresh.refresh_token_expires_in,
          },
        })
        return fresh.access_token
      } catch (error) {
        if (!(error instanceof GitHubReauthorizationRequiredError)) throw error
        await tx.account.update({
          where: { id: account.id },
          data: { access_token: null, refresh_token: null, expires_at: null, refresh_token_expires_in: null },
        })
        return null
      }
    }, { timeout: 15_000 })
  } catch {
    // Prisma errors can include query inputs. Never expose their message to callers/logs.
    throw new GitHubTokenRefreshError()
  }
}
