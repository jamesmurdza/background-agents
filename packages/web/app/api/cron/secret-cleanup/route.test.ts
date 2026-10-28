import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { cleanupSecrets } = vi.hoisted(() => ({ cleanupSecrets: vi.fn() }))
vi.mock("@/lib/server/secret-cleanup", () => ({ cleanupSecrets }))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class {} }))

import { GET } from "./route"

const request = (query = "", headers?: Record<string, string>) =>
  new Request(`https://example.com/api/cron/secret-cleanup${query}`, { headers })

beforeEach(() => {
  cleanupSecrets.mockReset().mockResolvedValue({ dryRun: true, scanned: 0, deleted: [], young: 0, ignored: 0, errors: 0 })
  vi.stubEnv("DAYTONA_API_KEY", "dtn-test")
  vi.stubEnv("CRON_SECRET", "")
  vi.stubEnv("DAYTONA_SECRET_CLEANUP", "")
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("secret-cleanup cron", () => {
  it("rejects a request without the configured CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t")
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request("", { authorization: "Bearer s3cr3t" }))).status).toBe(200)
  })

  it("only reports unless DAYTONA_SECRET_CLEANUP=1, and ?dryRun=1 reports even then", async () => {
    await GET(request())
    expect(cleanupSecrets).toHaveBeenLastCalledWith(expect.anything(), { dryRun: true })
    vi.stubEnv("DAYTONA_SECRET_CLEANUP", "1")
    await GET(request())
    expect(cleanupSecrets).toHaveBeenLastCalledWith(expect.anything(), { dryRun: false })
    await GET(request("?dryRun=1"))
    expect(cleanupSecrets).toHaveBeenLastCalledWith(expect.anything(), { dryRun: true })
  })

  it("skips without a Daytona key, and fails without leaking the error", async () => {
    vi.stubEnv("DAYTONA_API_KEY", "")
    expect(await (await GET(request())).json()).toEqual({ skipped: "DAYTONA_API_KEY is not set" })
    vi.stubEnv("DAYTONA_API_KEY", "dtn-test")
    vi.spyOn(console, "error").mockImplementation(() => {})
    cleanupSecrets.mockRejectedValue(new Error("private detail"))
    const res = await GET(request())
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain("private detail")
  })
})
