import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { environment } = vi.hoisted(() => ({
  environment: {
    findFirst: vi.fn(),
    update: vi.fn(),
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

import { POST } from "./route"

function makeRequest() {
  return new Request("http://localhost/api/environments/env_1/revert-script", {
    method: "POST",
  }) as unknown as import("next/server").NextRequest
}

function params(id = "env_1") {
  return { params: Promise.resolve({ id }) }
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "env_1",
    userId: "u1",
    repo: "acme/app",
    name: "Default",
    isDefault: false,
    networkMode: "full",
    allowedDomains: [],
    environmentVariables: null,
    setupScript: "echo new",
    setupScriptPrevious: "echo old",
    setupScriptUpdatedBy: "agent",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  environment.findFirst.mockReset()
  environment.update.mockReset()
})

describe("POST /api/environments/[id]/revert-script", () => {
  it("404s when the environment doesn't exist or isn't owned by the caller", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await POST(makeRequest(), params())

    expect(environment.findFirst).toHaveBeenCalledWith({ where: { id: "env_1", userId: "u1" } })
    expect(res.status).toBe(404)
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("400s when there is no previous version to revert to", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ setupScriptPrevious: null }))

    const res = await POST(makeRequest(), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("no previous version")
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("swaps setupScriptPrevious into setupScript, stashes the replaced script, and stamps the revert as a user edit", async () => {
    environment.findFirst.mockResolvedValueOnce(row())
    environment.update.mockResolvedValueOnce(
      row({ setupScript: "echo old", setupScriptPrevious: "echo new", setupScriptUpdatedBy: "user" })
    )

    const res = await POST(makeRequest(), params())
    const body = await res.json()

    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env_1" },
      data: {
        setupScript: "echo old",
        setupScriptPrevious: "echo new",
        setupScriptUpdatedBy: "user",
      },
    })
    expect(res.status).toBe(200)
    expect(body.environment.setupScript).toBe("echo old")
    expect(body.environment.setupScriptPrevious).toBe("echo new")
    expect(body.environment.setupScriptUpdatedBy).toBe("user")
  })

  it("does not leak another user's environment", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await POST(makeRequest(), params("someone-elses-env"))

    expect(environment.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses-env", userId: "u1" },
    })
    expect(res.status).toBe(404)
  })
})
