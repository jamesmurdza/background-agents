import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const testDbUrl = process.env.DATABASE_URL ?? ""
const hasLocalTestDb = /@(?:localhost|127\.0\.0\.1):/.test(testDbUrl) && /_test(?:\?|$)/.test(testDbUrl)

const testUsers: string[] = []
let prisma: typeof import("@/lib/db/prisma").prisma
let getGitHubToken: typeof import("./oauth-token").getGitHubToken
let GitHubTokenRefreshError: typeof import("./oauth-token").GitHubTokenRefreshError

async function createAccount(expiresAt: number | null) {
  const user = await prisma.user.create({
    data: { email: `github-token-${crypto.randomUUID()}@example.test` },
  })
  testUsers.push(user.id)
  await prisma.account.create({
    data: {
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: `test-${crypto.randomUUID()}`,
      access_token: "old-access",
      refresh_token: expiresAt ? "old-refresh" : null,
      expires_at: expiresAt,
      refresh_token_expires_in: expiresAt ? 15_897_600 : null,
    },
  })
  return user.id
}

describe.runIf(hasLocalTestDb)("getGitHubToken", () => {
  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/db/prisma"))
    ;({ getGitHubToken, GitHubTokenRefreshError } = await import("./oauth-token"))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    for (const id of testUsers.splice(0)) {
      await prisma.user.delete({ where: { id } })
    }
  })

  it("uses an unexpired, non-rotating OAuth grant as-is", async () => {
    const userId = await createAccount(null)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(await getGitHubToken(userId)).toBe("old-access")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refreshes an expired grant once under concurrent callers and persists both rotated tokens", async () => {
    const userId = await createAccount(Math.floor(Date.now() / 1000) - 10)
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-client-secret")
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const tokens = await Promise.all([getGitHubToken(userId), getGitHubToken(userId)])
    expect(tokens).toEqual(["new-access", "new-access"])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, request] = fetchMock.mock.calls[0]
    expect(new URLSearchParams(request.body).get("refresh_token")).toBe("old-refresh")
    expect(new URLSearchParams(request.body).get("grant_type")).toBe("refresh_token")

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    expect(account.access_token).toBe("new-access")
    expect(account.refresh_token).toBe("new-refresh")
    expect(account.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 28_000)
  })

  it("requires re-authorization when GitHub rejects the refresh token", async () => {
    const userId = await createAccount(Math.floor(Date.now() / 1000) - 10)
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-client-secret")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: "bad_refresh_token" }),
    }))

    expect(await getGitHubToken(userId)).toBeNull()
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    expect(account.access_token).toBeNull()
    expect(account.refresh_token).toBeNull()
  })

  it("does not leak a malformed token response or discard a grant on a transient failure", async () => {
    const userId = await createAccount(Math.floor(Date.now() / 1000) - 10)
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id")
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-client-secret")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "not-json SECRET_SHOULD_NOT_LEAK",
    }))

    await expect(getGitHubToken(userId)).rejects.toBeInstanceOf(GitHubTokenRefreshError)
    const error = await getGitHubToken(userId).catch((e: unknown) => e)
    expect(String(error)).not.toContain("SECRET_SHOULD_NOT_LEAK")
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    expect(account.access_token).toBe("old-access")
    expect(account.refresh_token).toBe("old-refresh")
  })
})
