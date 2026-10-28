import { afterEach, describe, expect, it, vi } from "vitest"
import type { ClaudeOAuthCredentials } from "@background-agents/claude-credentials"
import { ClaudeRefreshRejectedError, claudeTokenExpiring, parseClaudeCredentials, refreshClaudeOAuth } from "./claude-oauth"

const NOW = 1_800_000_000_000
const creds = (oauth: Partial<ClaudeOAuthCredentials["claudeAiOauth"]> = {}): ClaudeOAuthCredentials => ({
  claudeAiOauth: {
    accessToken: "sk-ant-oat01-old",
    refreshToken: "sk-ant-ort01-old",
    expiresAt: NOW,
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "max",
    ...oauth,
  } as ClaudeOAuthCredentials["claudeAiOauth"],
})

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("parseClaudeCredentials", () => {
  it("needs an access token, not a refresh token", () => {
    expect(parseClaudeCredentials(JSON.stringify(creds({ refreshToken: undefined })))?.claudeAiOauth.accessToken).toBe("sk-ant-oat01-old")
    expect(parseClaudeCredentials(JSON.stringify({ claudeAiOauth: { refreshToken: "r" } }))).toBeNull()
    expect(parseClaudeCredentials("not json")).toBeNull()
  })
})

describe("claudeTokenExpiring", () => {
  it("is true within the margin or with no expiry", () => {
    expect(claudeTokenExpiring(creds({ expiresAt: NOW + 60_000 }), 120_000, NOW)).toBe(true)
    expect(claudeTokenExpiring(creds({ expiresAt: NOW + 600_000 }), 120_000, NOW)).toBe(false)
    expect(claudeTokenExpiring(creds({ expiresAt: undefined }), 0, NOW)).toBe(true)
  })
})

describe("refreshClaudeOAuth", () => {
  it("spends the refresh token as Claude Code does and keeps every other field", async () => {
    const fetchMock = respond(200, { access_token: "sk-ant-oat01-new", refresh_token: "sk-ant-ort01-new", expires_in: 3600, scope: "user:inference" })
    const result = await refreshClaudeOAuth(creds(), NOW)
    expect(result.claudeAiOauth).toMatchObject({
      accessToken: "sk-ant-oat01-new",
      refreshToken: "sk-ant-ort01-new",
      expiresAt: NOW + 3_600_000,
      scopes: ["user:inference"],
      subscriptionType: "max",
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://platform.claude.com/v1/oauth/token")
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "sk-ant-ort01-old",
      client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
      scope: "user:inference user:profile",
    })
  })

  it("keeps the refresh token and scopes when the response leaves them out", async () => {
    respond(200, { access_token: "sk-ant-oat01-new", expires_in: 60 })
    const { claudeAiOauth } = await refreshClaudeOAuth(creds(), NOW)
    expect(claudeAiOauth.refreshToken).toBe("sk-ant-ort01-old")
    expect(claudeAiOauth.scopes).toEqual(["user:inference", "user:profile"])
  })

  it("honours the endpoint overrides", async () => {
    vi.stubEnv("CLAUDE_OAUTH_TOKEN_URL", "https://oauth.test/token")
    vi.stubEnv("CLAUDE_OAUTH_CLIENT_ID", "client-test")
    const fetchMock = respond(200, { access_token: "a", expires_in: 60 })
    await refreshClaudeOAuth(creds(), NOW)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://oauth.test/token")
    expect(JSON.parse(init.body as string).client_id).toBe("client-test")
  })

  it("rejects a dead or missing refresh token for good", async () => {
    respond(400, { error: "invalid_grant", error_description: "Refresh token revoked" })
    await expect(refreshClaudeOAuth(creds(), NOW)).rejects.toBeInstanceOf(ClaudeRefreshRejectedError)
    respond(401, { error: { type: "invalid_grant", message: "Invalid refresh token" } })
    await expect(refreshClaudeOAuth(creds(), NOW)).rejects.toBeInstanceOf(ClaudeRefreshRejectedError)
    const fetchMock = respond(200, {})
    await expect(refreshClaudeOAuth(creds({ refreshToken: undefined }), NOW)).rejects.toBeInstanceOf(ClaudeRefreshRejectedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails anything else as transient, never quoting a token", async () => {
    const cases = [
      [500, { error: "server_error" }],
      [429, { error: { type: "rate_limit_error", message: "Rate limited. Please try again later." } }],
      [403, { error: "invalid_grant" }],
      // An account on hold: Claude Code sends the user to error_uri rather than to a new login.
      [400, { error: "invalid_grant", error_description: "On hold", error_uri: "https://claude.ai/hold" }],
      [200, { expires_in: 60 }],
    ] as const
    for (const [status, body] of cases) {
      respond(status, body)
      const err = await refreshClaudeOAuth(creds(), NOW).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(ClaudeRefreshRejectedError)
      expect(String(err)).not.toMatch(/sk-ant/)
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed sk-ant-ort01-old") }))
    const err = await refreshClaudeOAuth(creds(), NOW).catch((e: unknown) => e)
    expect(String(err)).not.toMatch(/sk-ant/)
  })
})
