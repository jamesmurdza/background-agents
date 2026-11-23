import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ run: vi.fn(), credentials: vi.fn(), mount: vi.fn(), own: vi.fn() }))
vi.mock("@/lib/server/turn-secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/turn-secrets")>()),
  mountClaudeSecret: state.mount,
}))
vi.mock("@/lib/server/user-claude-credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/user-claude-credentials")>()),
  getUserClaudeAccessToken: state.own,
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  chat: { findFirst: state.run }, ccAuthInfo: { findUnique: state.credentials },
} }))
import { GET } from "./route"
import { createClaudeTokenCapability } from "@/lib/server/claude-token-auth"
import { OwnClaudeCredentialsExpiredError } from "@/lib/server/user-claude-credentials"
import { TurnSecretsUnavailableError } from "@/lib/server/turn-secrets"
import { SECRETS_UNAVAILABLE_CODE } from "@/lib/secrets-failure"

const scope = { userId: "user-test", chatId: "chat-test", backgroundSessionId: "run-test", source: "shared" as const }
function grant(accessToken: string, expiresAt = Date.now() + 3600000) {
  return { value: JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: "server-refresh-test", expiresAt } }) }
}
function request(token = createClaudeTokenCapability(scope)) {
  return new Request("https://app.test/api/claude-token", { headers: { Authorization: `Bearer ${token}` } })
}
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "token-read-signing-test")
  vi.stubEnv("DAYTONA_USER_KEY_SECRETS", "none")
  state.run.mockReset().mockResolvedValue({ id: scope.chatId })
  state.credentials.mockReset().mockResolvedValue(grant("access-test"))
  state.mount.mockReset().mockResolvedValue(undefined)
  state.own.mockReset().mockResolvedValue("own-access-test")
})
afterEach(() => { vi.unstubAllEnvs() })

describe("Claude host token reads", () => {
  it("reads the latest token each time without returning the refresh token", async () => {
    state.credentials.mockResolvedValueOnce(grant("old-access-test")).mockResolvedValueOnce(grant("new-access-test"))
    const first = await GET(request())
    expect(await first.json()).toEqual({ accessToken: "old-access-test" })
    expect(first.headers.get("cache-control")).toContain("no-store")
    expect(await (await GET(request())).json()).toEqual({ accessToken: "new-access-test" })
    expect(state.credentials).toHaveBeenCalledTimes(2)
    expect(state.run).toHaveBeenCalledWith({ where: { userId: scope.userId, backgroundSessionId: scope.backgroundSessionId, id: scope.chatId,
      agent: "claude-code", status: "running" }, select: { id: true, sandboxId: true } })
  })

  it("hands a run on a sandbox the token's Daytona secret placeholder instead, when there is one", async () => {
    vi.stubEnv("DAYTONA_API_KEY", "dtn-test")
    vi.stubEnv("DAYTONA_USER_KEY_SECRETS", "all")
    state.run.mockResolvedValue({ id: scope.chatId, sandboxId: "sb-test" })
    state.mount.mockResolvedValueOnce("dtn_secret_test")
    expect(await (await GET(request())).json()).toEqual({ accessToken: "dtn_secret_test" })
    expect(state.mount).toHaveBeenCalledWith(expect.anything(), "sb-test", scope.userId, { source: "shared", token: "access-test" })
    // No placeholder (feature off): the token, as before.
    vi.stubEnv("DAYTONA_USER_KEY_SECRETS", "none")
    expect(await (await GET(request())).json()).toEqual({ accessToken: "access-test" })
  })

  it("answers 503, never the raw token, when the token's secret fails", async () => {
    vi.stubEnv("DAYTONA_API_KEY", "dtn-test")
    vi.stubEnv("DAYTONA_USER_KEY_SECRETS", "all")
    state.run.mockResolvedValue({ id: scope.chatId, sandboxId: "sb-test" })
    state.mount.mockRejectedValueOnce(new TurnSecretsUnavailableError())
    const response = await GET(request())
    expect(response.status).toBe(503)
    const failure = await response.json()
    expect(failure).toMatchObject({ code: SECRETS_UNAVAILABLE_CODE })
    expect(failure).not.toHaveProperty("accessToken")
  })

  it("fails closed when the protected token has no sandbox to mount on", async () => {
    vi.stubEnv("DAYTONA_USER_KEY_SECRETS", "all")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: SECRETS_UNAVAILABLE_CODE })
      expect(state.mount).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it("serves a run on the user's own subscription their (refreshed) token, never the shared one", async () => {
    vi.stubEnv("DAYTONA_API_KEY", "dtn-test")
    state.run.mockResolvedValue({ id: scope.chatId, sandboxId: "sb-test" })
    const own = createClaudeTokenCapability({ ...scope, source: "own" })
    expect(await (await GET(request(own))).json()).toEqual({ accessToken: "own-access-test" })
    expect(state.own).toHaveBeenCalledWith(scope.userId)
    expect(state.credentials).not.toHaveBeenCalled()
    expect(state.mount).not.toHaveBeenCalled()
  })

  it("answers 503 when the user's own login can't be used", async () => {
    state.own.mockRejectedValue(new OwnClaudeCredentialsExpiredError())
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await GET(request(createClaudeTokenCapability({ ...scope, source: "own" })))
      expect(response.status).toBe(503)
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it("rejects invalid capabilities before querying credentials", async () => {
    expect((await GET(request("forged.signature"))).status).toBe(401)
    expect(state.run).not.toHaveBeenCalled()
    expect(state.credentials).not.toHaveBeenCalled()
  })

  it("revokes credential reads once the originating run ends", async () => {
    state.run.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect(state.credentials).not.toHaveBeenCalled()
  })

  it.each([null, { value: "malformed secret input" }, grant("expired-test", Date.now() - 1), grant("expiring-test", Date.now() + 1000)])(
    "rejects missing, malformed and expired database tokens", async (row) => {
      state.credentials.mockResolvedValue(row)
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toMatch(/secret input|expired-test|expiring-test|server-refresh-test/)
    }
  )

  it("hides credential-bearing database errors", async () => {
    state.credentials.mockRejectedValue(new Error("private-db-url-test"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await GET(request())
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain("private-db-url-test")
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-db-url-test")
    } finally { log.mockRestore() }
  })
})
