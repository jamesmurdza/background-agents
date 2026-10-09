import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ run: vi.fn(), credentials: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  chat: { findFirst: state.run }, ccAuthInfo: { findUnique: state.credentials },
} }))
import { GET } from "./route"
import { createClaudeTokenCapability } from "@/lib/server/claude-token-auth"

const scope = { userId: "user-test", chatId: "chat-test", backgroundSessionId: "run-test" }
function grant(accessToken: string, expiresAt = Date.now() + 3600000) {
  return { value: JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: "server-refresh-test", expiresAt } }) }
}
function request(token = createClaudeTokenCapability(scope)) {
  return new Request("https://app.test/api/claude-token", { headers: { Authorization: `Bearer ${token}` } })
}
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "token-read-signing-test")
  state.run.mockReset().mockResolvedValue({ id: scope.chatId })
  state.credentials.mockReset().mockResolvedValue(grant("access-test"))
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
      agent: "claude-code", status: "running" }, select: { id: true } })
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
