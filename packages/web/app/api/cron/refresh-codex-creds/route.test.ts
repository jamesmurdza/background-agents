import { describe, it, expect, vi, beforeEach } from "vitest"

const { queryRaw, refreshCodexCredentialForUser } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  refreshCodexCredentialForUser: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $queryRaw: queryRaw },
}))
vi.mock("@/lib/server/codex-credentials", () => ({
  refreshCodexCredentialForUser,
}))

import { GET } from "./route"

function fakeRequest(headers?: Record<string, string>): Request {
  return new Request("https://example.com/api/cron/refresh-codex-creds", { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
})

describe("refresh-codex-creds route: auth", () => {
  it("rejects a request without the right CRON_SECRET header when the secret is configured", async () => {
    process.env.CRON_SECRET = "s3cr3t"

    const res = await GET(fakeRequest())

    expect(res.status).toBe(401)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("accepts a request carrying the configured CRON_SECRET", async () => {
    process.env.CRON_SECRET = "s3cr3t"
    queryRaw.mockResolvedValue([])

    const res = await GET(fakeRequest({ authorization: "Bearer s3cr3t" }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scanned: 0 })
  })
})

describe("refresh-codex-creds route: tally", () => {
  it("tallies a mixed set of outcomes into their own counters, exercising every union member", async () => {
    const users = [
      { id: "u-refreshed" },
      { id: "u-skipped" },
      { id: "u-needs-reconnect" },
      { id: "u-transient" },
      { id: "u-absent" },
    ]
    queryRaw.mockResolvedValue(users)
    refreshCodexCredentialForUser.mockImplementation(async (userId: string) => {
      switch (userId) {
        case "u-refreshed":
          return "refreshed"
        case "u-skipped":
          return "skipped"
        case "u-needs-reconnect":
          return "needs_reconnect"
        case "u-transient":
          return "transient_failure"
        case "u-absent":
          return "absent"
        default:
          throw new Error(`unexpected user ${userId}`)
      }
    })

    const res = await GET(fakeRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      scanned: 5,
      refreshed: 1,
      skipped: 1,
      needsReconnect: 1,
      transientFailure: 1,
      absent: 1,
      errored: 0,
    })
  })

  it("does not abort the sweep when one user throws, and keeps processing the rest", async () => {
    const users = [{ id: "u-fails" }, { id: "u-ok-1" }, { id: "u-ok-2" }]
    queryRaw.mockResolvedValue(users)
    refreshCodexCredentialForUser.mockImplementation(async (userId: string) => {
      if (userId === "u-fails") throw new Error("boom")
      return "refreshed"
    })

    const res = await GET(fakeRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      scanned: 3,
      refreshed: 2,
      skipped: 0,
      needsReconnect: 0,
      transientFailure: 0,
      absent: 0,
      errored: 1,
    })
    expect(refreshCodexCredentialForUser).toHaveBeenCalledTimes(3)
    expect(refreshCodexCredentialForUser).toHaveBeenCalledWith("u-ok-1")
    expect(refreshCodexCredentialForUser).toHaveBeenCalledWith("u-ok-2")
  })

  it("never logs token material when a user sweep fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    queryRaw.mockResolvedValue([{ id: "u-fails" }])
    refreshCodexCredentialForUser.mockRejectedValue(new Error("network blip"))

    await GET(fakeRequest())

    for (const call of consoleSpy.mock.calls) {
      const serialized = JSON.stringify(call)
      expect(serialized).not.toContain("refresh_token")
      expect(serialized).not.toContain("access_token")
    }
    consoleSpy.mockRestore()
  })
})
