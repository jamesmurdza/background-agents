import { beforeAll, describe, expect, it } from "vitest"

const testDbUrl = process.env.DATABASE_URL ?? ""
const hasLocalTestDb = /@(?:localhost|127\.0\.0\.1):/.test(testDbUrl) && /_test(?:\?|$)/.test(testDbUrl)

describe.runIf(hasLocalTestDb)("GitHub OAuth account persistence", () => {
  let authOptions: typeof import("./auth").authOptions
  let prisma: typeof import("./db/prisma").prisma

  beforeAll(async () => {
    ;({ authOptions } = await import("./auth"))
    ;({ prisma } = await import("./db/prisma"))
  })

  it("stores expiring GitHub grants without losing their refresh token", async () => {
    const user = await prisma.user.create({
      data: { email: `github-oauth-${crypto.randomUUID()}@example.test` },
    })

    try {
      const account = {
        userId: user.id,
        type: "oauth" as const,
        provider: "github",
        providerAccountId: `test-${crypto.randomUUID()}`,
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 28_800,
        refresh_token_expires_in: 15_897_600,
      }

      await authOptions.adapter!.linkAccount!(account)

      const stored = await prisma.account.findUniqueOrThrow({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
      })
      expect(stored.access_token).toBe(account.access_token)
      expect(stored.refresh_token).toBe(account.refresh_token)
      expect(stored.expires_at).toBe(account.expires_at)
      expect(stored.refresh_token_expires_in).toBe(account.refresh_token_expires_in)
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  it("replaces the full token pair when an existing account re-authorizes", async () => {
    const user = await prisma.user.create({
      data: { email: `github-reauth-${crypto.randomUUID()}@example.test` },
    })
    const providerAccountId = `test-${crypto.randomUUID()}`

    try {
      await prisma.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId,
          access_token: "old-access",
          refresh_token: "old-refresh",
          expires_at: 1,
          refresh_token_expires_in: 1,
        },
      })

      const jwt = authOptions.callbacks?.jwt
      if (!jwt) throw new Error("JWT callback not configured")
      await jwt({
        token: { sub: user.id },
        account: {
          provider: "github",
          type: "oauth",
          providerAccountId,
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: 50_000,
          refresh_token_expires_in: 15_897_600,
        },
      } as unknown as Parameters<typeof jwt>[0])

      const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } })
      expect(account.access_token).toBe("new-access")
      expect(account.refresh_token).toBe("new-refresh")
      expect(account.expires_at).toBe(50_000)
      expect(account.refresh_token_expires_in).toBe(15_897_600)
    } finally {
      await prisma.user.delete({ where: { id: user.id } })
    }
  })
})
