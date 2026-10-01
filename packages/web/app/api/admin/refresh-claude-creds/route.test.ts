/**
 * PUT /api/admin/refresh-claude-creds used to store a hand-pasted credential
 * verbatim, with no check that its access token was actually still valid. A
 * paste that arrives already expired is common — it's often copied from a
 * local machine's ~/.claude/.credentials.json sometime after login, with the
 * access token stale but the refresh token still good. The CLI self-heals
 * that on its own on first use, but refreshing it here too means the admin
 * tab's "saved" response (and the very first sandbox that reads this row)
 * see an already-current token right away. These tests pin that behavior: a
 * stale paste must trigger an on-the-spot refresh; a fresh paste must not
 * (no reason to burn an extra refresh call).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/api-helpers", () => ({
  requireAdmin: vi.fn(async () => ({ userId: "admin-1" })),
  isAuthError: (r: unknown) => r instanceof Response,
}))

const writeCredentials = vi.fn(async (...args: unknown[]) => {})
vi.mock("@/lib/claude-credentials", () => ({
  setCookies: vi.fn(async () => {}),
  writeCredentials: (...a: unknown[]) => writeCredentials(...a),
  listCcAuthRuns: vi.fn(async () => []),
}))

const refreshCredentials = vi.fn()
vi.mock("@/lib/server/refresh-claude-credentials", () => ({
  refreshCredentials: (...a: unknown[]) => refreshCredentials(...a),
  refreshResultToResponse: vi.fn(),
}))

import { PUT } from "./route"

const nowMs = () => Date.now()

function putRequest(credentials: unknown) {
  return new Request("http://localhost/api/admin/refresh-claude-creds", {
    method: "PUT",
    body: JSON.stringify({ credentials: JSON.stringify(credentials) }),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  writeCredentials.mockResolvedValue(undefined)
})

describe("PUT /api/admin/refresh-claude-creds", () => {
  it("refreshes on the spot when the pasted access token is already expired", async () => {
    const refreshedExpiresAt = nowMs() + 9999
    refreshCredentials.mockResolvedValue({ status: "refreshed", expiresAt: refreshedExpiresAt })

    const res = await PUT(
      putRequest({
        claudeAiOauth: {
          accessToken: "at.stale",
          refreshToken: "rt.still-good",
          expiresAt: nowMs() - 60_000, // already expired
        },
      })
    )

    expect(writeCredentials).toHaveBeenCalledTimes(1) // the paste itself is still saved
    expect(refreshCredentials).toHaveBeenCalledWith({ force: true, trigger: "admin" })
    const body = await (res as Response).json()
    expect(body.saved).toBe(true)
    expect(body.expiresAt).toBe(refreshedExpiresAt) // from the refresh result, not the stale paste
  })

  it("refreshes when the pasted token is within the stale buffer (not yet expired, but close)", async () => {
    refreshCredentials.mockResolvedValue({ status: "refreshed", expiresAt: nowMs() + 8 * 3600_000 })

    await PUT(
      putRequest({
        claudeAiOauth: {
          accessToken: "at.almost-stale",
          refreshToken: "rt.good",
          expiresAt: nowMs() + 60_000, // 1 minute left, under the 5-minute buffer
        },
      })
    )

    expect(refreshCredentials).toHaveBeenCalledTimes(1)
  })

  it("refreshes when the paste omits expiresAt entirely", async () => {
    refreshCredentials.mockResolvedValue({ status: "refreshed", expiresAt: nowMs() + 8 * 3600_000 })

    await PUT(
      putRequest({
        claudeAiOauth: { accessToken: "at.x", refreshToken: "rt.x" },
      })
    )

    expect(refreshCredentials).toHaveBeenCalledTimes(1)
  })

  it("does NOT refresh when the pasted token already has plenty of life left", async () => {
    await PUT(
      putRequest({
        claudeAiOauth: {
          accessToken: "at.fresh",
          refreshToken: "rt.fresh",
          expiresAt: nowMs() + 8 * 3600_000,
        },
      })
    )

    expect(writeCredentials).toHaveBeenCalledTimes(1)
    expect(refreshCredentials).not.toHaveBeenCalled()
  })

  it("still reports saved:true (with a refreshError) when the on-the-spot refresh fails", async () => {
    refreshCredentials.mockResolvedValue({
      status: "error",
      code: "REFRESH_FAILED",
      message: "boom",
    })

    const res = await PUT(
      putRequest({
        claudeAiOauth: {
          accessToken: "at.stale",
          refreshToken: "rt.dead",
          expiresAt: nowMs() - 60_000,
        },
      })
    )

    const body = await (res as Response).json()
    expect(body.saved).toBe(true)
    expect(body.refreshError).toEqual({ code: "REFRESH_FAILED", message: "boom" })
  })

  it("rejects a paste missing accessToken/refreshToken before ever calling writeCredentials", async () => {
    const res = await PUT(putRequest({ claudeAiOauth: { accessToken: "only-this" } }))
    expect((res as Response).status).toBe(400)
    expect(writeCredentials).not.toHaveBeenCalled()
    expect(refreshCredentials).not.toHaveBeenCalled()
  })
})
