import { describe, it, expect, vi, afterEach } from "vitest"
import {
  refreshCodexTokens,
  revokeCodexToken,
  CodexReconnectRequiredError,
  CODEX_OAUTH_CLIENT_ID,
} from "./codex-oauth"

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("refreshCodexTokens", () => {
  it("posts the public client id and returns the rotated tokens", async () => {
    const fetchFn = mockFetch(200, {
      access_token: "at.new",
      refresh_token: "rt.rotated",
      id_token: "id.new",
      expires_in: 864000,
      earliest_refresh_at: 1789431731,
    })

    const res = await refreshCodexTokens("rt.old")

    expect(res.refresh_token).toBe("rt.rotated")
    expect(res.expires_in).toBe(864000)
    expect(res.earliest_refresh_at).toBe(1789431731)

    const [, init] = fetchFn.mock.calls[0]
    const sent = JSON.parse(init.body as string)
    expect(sent.grant_type).toBe("refresh_token")
    expect(sent.client_id).toBe(CODEX_OAUTH_CLIENT_ID)
    expect(sent.refresh_token).toBe("rt.old")
  })

  it("raises CodexReconnectRequiredError on invalid_grant — never retried", async () => {
    mockFetch(400, { error: "invalid_grant", error_description: "token expired" })
    await expect(refreshCodexTokens("rt.dead")).rejects.toBeInstanceOf(CodexReconnectRequiredError)
  })

  it("raises a plain Error on a transient server failure, so callers may retry", async () => {
    mockFetch(503, { error: "server_error" })
    const err = await refreshCodexTokens("rt.ok").catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(CodexReconnectRequiredError)
  })

  it("never puts a token value in the error message", async () => {
    mockFetch(400, { error: "invalid_grant" })
    const err = await refreshCodexTokens("rt.SUPER_SECRET").catch((e) => e)
    expect(String(err.message)).not.toContain("SUPER_SECRET")
  })
})

describe("revokeCodexToken", () => {
  it("returns true when OpenAI accepts the revocation", async () => {
    mockFetch(200, {})
    expect(await revokeCodexToken("rt.old")).toBe(true)
  })

  it("returns false rather than throwing when revocation fails", async () => {
    mockFetch(400, { error: "invalid_token" })
    expect(await revokeCodexToken("rt.old")).toBe(false)
  })
})
