import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

// CODEX_SUBSCRIPTION_ENABLED reads process.env at module-eval time and is
// off by default. Expose a mutable flag (live binding via a getter) so tests
// can exercise both the on and off branches of the route's guard, following
// the same pattern as
// app/api/chats/[chatId]/messages/_lib/resolve-credentials.test.ts.
const {
  startCodexDeviceLogin,
  pollCodexDeviceLogin,
  disconnectCodex,
  readCodexCredential,
  codexFlagState,
} = vi.hoisted(() => ({
  startCodexDeviceLogin: vi.fn(),
  pollCodexDeviceLogin: vi.fn(),
  disconnectCodex: vi.fn(),
  readCodexCredential: vi.fn(),
  codexFlagState: { enabled: true },
}))

vi.mock("@/lib/server/codex-login", () => ({
  startCodexDeviceLogin,
  pollCodexDeviceLogin,
}))
vi.mock("@/lib/server/codex-credentials", () => ({
  disconnectCodex,
  readCodexCredential,
}))
vi.mock("@/lib/codex-credentials", () => ({
  get CODEX_SUBSCRIPTION_ENABLED() {
    return codexFlagState.enabled
  },
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: "authenticated-user" }),
  isAuthError: (r: unknown) => r instanceof Response,
  internalError: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 }),
}))

import { POST, GET, DELETE } from "./route"

function fakeGetRequest(sessionId?: string): NextRequest {
  const url = sessionId
    ? `https://example.com/api/user/codex-auth?sessionId=${sessionId}`
    : "https://example.com/api/user/codex-auth"
  return { url } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  codexFlagState.enabled = true
})

describe("codex-auth route: disabled flag", () => {
  it("POST returns the disabled response when the flag is off", async () => {
    codexFlagState.enabled = false
    const res = await POST()
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: "CODEX_SUBSCRIPTION_DISABLED" })
    expect(startCodexDeviceLogin).not.toHaveBeenCalled()
  })

  it("GET returns the disabled response when the flag is off", async () => {
    codexFlagState.enabled = false
    const res = await GET(fakeGetRequest())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "CODEX_SUBSCRIPTION_DISABLED" })
    expect(readCodexCredential).not.toHaveBeenCalled()
  })

  it("DELETE returns the disabled response when the flag is off", async () => {
    codexFlagState.enabled = false
    const res = await DELETE()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "CODEX_SUBSCRIPTION_DISABLED" })
    expect(disconnectCodex).not.toHaveBeenCalled()
  })
})

describe("codex-auth route: POST /connect", () => {
  it("returns the sessionId/url/code payload", async () => {
    startCodexDeviceLogin.mockResolvedValue({
      sessionId: "sess-1",
      url: "https://chatgpt.com/device",
      code: "ABCD-EFGH",
    })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sessionId: "sess-1",
      url: "https://chatgpt.com/device",
      code: "ABCD-EFGH",
    })
    expect(startCodexDeviceLogin).toHaveBeenCalledWith("authenticated-user")
  })

  it("maps a DEVICE_AUTH_UNAVAILABLE:admin_blocked throw to a 409 carrying that reason", async () => {
    startCodexDeviceLogin.mockRejectedValue(new Error("DEVICE_AUTH_UNAVAILABLE:admin_blocked"))

    const res = await POST()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: "DEVICE_AUTH_UNAVAILABLE",
      reason: "admin_blocked",
    })
  })
})

describe("codex-auth route: GET /poll and /status", () => {
  it("passes the authenticated user id through and returns the poll result verbatim, including an unusual reason", async () => {
    pollCodexDeviceLogin.mockResolvedValue({ status: "failed", reason: "credential_lost" })

    const res = await GET(fakeGetRequest("sess-1"))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "failed", reason: "credential_lost" })
    expect(pollCodexDeviceLogin).toHaveBeenCalledWith("authenticated-user", "sess-1")
  })

  it("returns connection status containing no token material when no sessionId is given", async () => {
    readCodexCredential.mockResolvedValue({
      refresh_token: "rt.super-secret",
      access_token: "at.super-secret",
      id_token: "it.super-secret",
      account_id: "acct-1",
      expires_at: 0,
      earliest_refresh_at: 0,
      last_refresh: "2026-01-01T00:00:00.000Z",
      status: "connected",
    })

    const res = await GET(fakeGetRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ connected: true, status: "connected" })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("refresh_token")
    expect(serialized).not.toContain("access_token")
    expect(readCodexCredential).toHaveBeenCalledWith("authenticated-user")
  })
})

describe("codex-auth route: DELETE /disconnect", () => {
  it("calls disconnectCodex with the authenticated user id", async () => {
    disconnectCodex.mockResolvedValue(undefined)

    const res = await DELETE()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(disconnectCodex).toHaveBeenCalledWith("authenticated-user")
  })
})
