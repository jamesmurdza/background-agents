import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { environment } = vi.hoisted(() => ({
  environment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { environment } }))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  badRequest: vi.fn((message: string) => Response.json({ error: message }, { status: 400 })),
  notFound: vi.fn((message: string) => Response.json({ error: message }, { status: 404 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 })
  ),
}))

import { Prisma } from "@prisma/client"
import { GET, POST } from "./route"
import { encryptEnvironmentVariables } from "@/lib/environments"

function makeRequest(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest
}

// Shape copied from a real P2002 forced against the scratch DB via
// @prisma/adapter-pg (Prisma 7.8.0). See task-6-report.md's smoke-test
// section for the transcript that produced this.
function p2002(fields: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
    code: "P2002",
    clientVersion: "test",
    meta: {
      modelName: "Environment",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          kind: "UniqueConstraintViolation",
          constraint: { fields },
        },
      },
    },
  })
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "env_1",
    userId: "u1",
    repo: "acme/app",
    name: "Default",
    isDefault: true,
    networkMode: "full",
    allowedDomains: [],
    environmentVariables: null,
    setupScript: null,
    setupScriptPrevious: null,
    setupScriptUpdatedBy: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  environment.findFirst.mockReset()
  environment.findMany.mockReset()
  environment.count.mockReset()
  environment.create.mockReset()
})

describe("GET /api/environments", () => {
  it("omits variables by default, returning only a count", async () => {
    const encrypted = encryptEnvironmentVariables({ FOO: "bar" })
    environment.findMany.mockResolvedValueOnce([row({ environmentVariables: encrypted })])

    const res = await GET(makeRequest("http://localhost/api/environments"))
    const body = await res.json()

    expect(environment.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: [{ repo: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    })
    expect(body.environments).toHaveLength(1)
    expect(body.environments[0].variables).toBeUndefined()
    expect(body.environments[0].variableCount).toBe(1)
    expect(body.environments[0].updatedAt).toBe(row().updatedAt.getTime())
  })

  it("includes decrypted variables when the caller asks for them via ?include=variables", async () => {
    const encrypted = encryptEnvironmentVariables({ FOO: "bar" })
    environment.findMany.mockResolvedValueOnce([row({ environmentVariables: encrypted })])

    const res = await GET(makeRequest("http://localhost/api/environments?include=variables"))
    const body = await res.json()

    expect(body.environments[0].variables).toEqual({ FOO: "bar" })
    expect(body.environments[0].variableCount).toBe(1)
  })

  it("filters by repo when a repo query param is given", async () => {
    environment.findMany.mockResolvedValueOnce([])

    await GET(makeRequest("http://localhost/api/environments?repo=acme/app"))

    expect(environment.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", repo: "acme/app" },
      orderBy: [{ repo: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    })
  })
})

describe("POST /api/environments", () => {
  it("rejects a missing repo", async () => {
    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ name: "Staging" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects a blank name", async () => {
    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "   " }),
    }))
    expect(res.status).toBe(400)
  })

  it("marks the first environment for a repo as default", async () => {
    environment.count.mockResolvedValueOnce(0)
    environment.create.mockResolvedValueOnce(row({ isDefault: true }))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Default" }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(environment.create.mock.calls[0][0].data.isDefault).toBe(true)
    expect(body.environment.isDefault).toBe(true)
  })

  it("does not default a later environment for a repo that already has one", async () => {
    environment.count.mockResolvedValueOnce(1)
    environment.create.mockResolvedValueOnce(row({ id: "env_2", isDefault: false, name: "Staging" }))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Staging" }),
    }))
    const body = await res.json()

    expect(environment.create.mock.calls[0][0].data.isDefault).toBe(false)
    expect(body.environment.isDefault).toBe(false)
  })

  it("404s when duplicating an environment the caller does not own", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Copy", duplicateOf: "someone-elses-env" }),
    }))

    expect(res.status).toBe(404)
    expect(environment.create).not.toHaveBeenCalled()
  })

  it("rejects duplicating an environment into a different repo", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ repo: "acme/app" }))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/other", name: "Copy", duplicateOf: "env_1" }),
    }))

    expect(res.status).toBe(400)
    expect(environment.create).not.toHaveBeenCalled()
  })

  it("rejects duplicating a restricted-network-mode source with a 400 explaining the SDK gap", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ networkMode: "restricted" }))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Copy", duplicateOf: "env_1" }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("@daytonaio/sdk")
    expect(environment.create).not.toHaveBeenCalled()
  })

  it("copies ciphertext verbatim on duplication, without decrypting", async () => {
    const encrypted = encryptEnvironmentVariables({ FOO: "bar" })
    environment.findFirst.mockResolvedValueOnce(
      row({
        id: "env_1",
        networkMode: "full",
        allowedDomains: ["example.com"],
        environmentVariables: encrypted,
        setupScript: "echo hi",
      })
    )
    environment.count.mockResolvedValueOnce(1)
    environment.create.mockResolvedValueOnce(row({ id: "env_2" }))

    await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Copy", duplicateOf: "env_1" }),
    }))

    const data = environment.create.mock.calls[0][0].data
    expect(data.environmentVariables).toBe(encrypted)
    expect(data.allowedDomains).toEqual(["example.com"])
    expect(data.setupScript).toBe("echo hi")
  })

  it("maps a (userId, repo, name) P2002 to a 400 naming the collision", async () => {
    environment.count.mockResolvedValueOnce(0)
    environment.create.mockRejectedValueOnce(p2002(['"userId"', "repo", "name"]))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Default" }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("environment with that name already exists")
  })

  it("maps a partial default-per-repo-index P2002 (a concurrent first-create race) to a distinct 400", async () => {
    environment.count.mockResolvedValueOnce(0)
    environment.create.mockRejectedValueOnce(p2002(['"userId"', "repo"]))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Default" }),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).not.toContain("name already exists")
    expect(body.error.toLowerCase()).toContain("default")
  })

  it("does not turn a non-P2002 error into a 400", async () => {
    environment.count.mockResolvedValueOnce(0)
    environment.create.mockRejectedValueOnce(new Error("connection refused"))

    const res = await POST(makeRequest("http://localhost/api/environments", {
      method: "POST",
      body: JSON.stringify({ repo: "acme/app", name: "Default" }),
    }))

    expect(res.status).toBe(500)
  })
})
