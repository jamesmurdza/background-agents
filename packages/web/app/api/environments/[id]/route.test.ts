import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { environment, transaction } = vi.hoisted(() => ({
  environment: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { environment, $transaction: transaction },
}))

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
import { GET, PATCH, DELETE } from "./route"
import { decryptEnvironmentVariables } from "@/lib/environments"

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

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/environments/env_1", {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
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
    setupScript: null,
    setupScriptPrevious: null,
    setupScriptUpdatedBy: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  environment.findFirst.mockReset()
  environment.update.mockReset()
  environment.updateMany.mockReset()
  environment.delete.mockReset()
  environment.count.mockReset()
  // mockClear (not mockReset): this mock's real job is to actually run its
  // ops (`Promise.all(ops)`), so clearing must not wipe that implementation.
  transaction.mockClear()
})

describe("GET /api/environments/[id]", () => {
  it("scopes the lookup to the caller's userId", async () => {
    environment.findFirst.mockResolvedValueOnce(row())

    const res = await GET(makeRequest(), params())

    expect(environment.findFirst).toHaveBeenCalledWith({ where: { id: "env_1", userId: "u1" } })
    expect(res.status).toBe(200)
  })

  it("404s when the environment belongs to another user or does not exist", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await GET(makeRequest(), params())

    expect(res.status).toBe(404)
  })
})

describe("PATCH /api/environments/[id]", () => {
  it("404s for an environment the caller does not own", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await PATCH(makeRequest({ name: "Renamed" }), params())

    expect(res.status).toBe(404)
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("rejects an unrecognized networkMode value with a generic 400", async () => {
    environment.findFirst.mockResolvedValueOnce(row())

    const res = await PATCH(makeRequest({ networkMode: "bogus" }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("networkMode must be one of")
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("rejects networkMode: restricted with a 400 explaining the SDK gap, not a generic message", async () => {
    environment.findFirst.mockResolvedValueOnce(row())

    const res = await PATCH(makeRequest({ networkMode: "restricted" }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("@daytonaio/sdk")
    expect(body.error).not.toContain("must be one of")
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("accepts networkMode: full", async () => {
    environment.findFirst.mockResolvedValueOnce(row())
    environment.update.mockResolvedValueOnce(row({ networkMode: "full" }))

    const res = await PATCH(makeRequest({ networkMode: "full" }), params())

    expect(res.status).toBe(200)
    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env_1" },
      data: { networkMode: "full" },
    })
  })

  it("rejects a blank name", async () => {
    environment.findFirst.mockResolvedValueOnce(row())

    const res = await PATCH(makeRequest({ name: "   " }), params())

    expect(res.status).toBe(400)
    expect(environment.update).not.toHaveBeenCalled()
  })

  it("encrypts variables before persisting", async () => {
    environment.findFirst.mockResolvedValueOnce(row())
    environment.update.mockResolvedValueOnce(row())

    await PATCH(makeRequest({ variables: { FOO: "bar" } }), params())

    const data = environment.update.mock.calls[0][0].data
    expect(decryptEnvironmentVariables(data.environmentVariables)).toEqual({ FOO: "bar" })
  })

  it("stashes the previous setup script and stamps setupScriptUpdatedBy as user", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ setupScript: "echo old" }))
    environment.update.mockResolvedValueOnce(row())

    await PATCH(makeRequest({ setupScript: "echo new" }), params())

    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env_1" },
      data: {
        setupScript: "echo new",
        setupScriptPrevious: "echo old",
        setupScriptUpdatedBy: "user",
      },
    })
  })

  it("leaves setupScriptPrevious untouched when setupScript is resent unchanged", async () => {
    environment.findFirst.mockResolvedValueOnce(
      row({ setupScript: "echo old", setupScriptPrevious: "echo ancient" })
    )
    environment.update.mockResolvedValueOnce(row())

    await PATCH(makeRequest({ setupScript: "echo old", name: "Renamed" }), params())

    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env_1" },
      data: {
        name: "Renamed",
        setupScript: "echo old",
      },
    })
  })

  it("promotes to default with an ordered clear-then-set transaction, not a single combined update", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: false }))
    environment.updateMany.mockResolvedValueOnce({ count: 1 })
    environment.update
      .mockResolvedValueOnce(undefined) // the transaction's promotion update
      .mockResolvedValueOnce(row({ isDefault: true })) // the trailing field-patch update

    const res = await PATCH(makeRequest({ isDefault: true }), params())
    const body = await res.json()

    // The two ordered statements must actually run inside prisma.$transaction,
    // as an array of exactly two operations, not merely be called somewhere.
    expect(transaction).toHaveBeenCalledTimes(1)
    const [ops] = transaction.mock.calls[0]
    expect(ops).toHaveLength(2)

    expect(environment.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", repo: "acme/app", isDefault: true },
      data: { isDefault: false },
    })
    expect(environment.update).toHaveBeenNthCalledWith(1, {
      where: { id: "env_1" },
      data: { isDefault: true },
    })

    // Ordering: the clear (updateMany) must have been INVOKED before the
    // promotion's set (this update call), not just both present in the
    // transaction array. invocationCallOrder is a global counter across all
    // mocks, so comparing it across the two different mock functions is valid
    // and would catch the array being built in the wrong order.
    expect(environment.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      environment.update.mock.invocationCallOrder[0]
    )

    expect(res.status).toBe(200)
    expect(body.environment.isDefault).toBe(true)
  })

  it("does not run the promotion transaction when the environment is already the default", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: true }))
    environment.update.mockResolvedValueOnce(row({ isDefault: true }))

    await PATCH(makeRequest({ isDefault: true }), params())

    expect(environment.updateMany).not.toHaveBeenCalled()
  })

  it("maps a (userId, repo, name) P2002 to a 400 naming the collision", async () => {
    environment.findFirst.mockResolvedValueOnce(row())
    environment.update.mockRejectedValueOnce(p2002(['"userId"', "repo", "name"]))

    const res = await PATCH(makeRequest({ name: "Taken" }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("environment with that name already exists")
  })

  it("maps a partial default-per-repo-index P2002 (a concurrent promotion race) to a distinct 400", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: false }))
    environment.updateMany.mockResolvedValueOnce({ count: 1 })
    environment.update.mockRejectedValueOnce(p2002(['"userId"', "repo"]))

    const res = await PATCH(makeRequest({ isDefault: true }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).not.toContain("name already exists")
    expect(body.error.toLowerCase()).toContain("default")
  })

  it("does not turn a non-P2002 error into a 400", async () => {
    environment.findFirst.mockResolvedValueOnce(row())
    environment.update.mockRejectedValueOnce(new Error("connection refused"))

    const res = await PATCH(makeRequest({ name: "Renamed" }), params())

    expect(res.status).toBe(500)
  })
})

describe("DELETE /api/environments/[id]", () => {
  it("404s for an environment the caller does not own", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await DELETE(makeRequest(), params())

    expect(res.status).toBe(404)
    expect(environment.delete).not.toHaveBeenCalled()
  })

  it("deletes a non-default environment", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: false }))
    environment.delete.mockResolvedValueOnce(row())

    const res = await DELETE(makeRequest(), params())
    const body = await res.json()

    expect(environment.delete).toHaveBeenCalledWith({ where: { id: "env_1" } })
    expect(body).toEqual({ success: true })
  })

  it("deletes the default when it is the repo's only environment", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: true }))
    environment.count.mockResolvedValueOnce(0)
    environment.delete.mockResolvedValueOnce(row())

    const res = await DELETE(makeRequest(), params())

    expect(res.status).toBe(200)
    expect(environment.delete).toHaveBeenCalledWith({ where: { id: "env_1" } })
  })

  it("refuses to delete the default while siblings exist", async () => {
    environment.findFirst.mockResolvedValueOnce(row({ isDefault: true }))
    environment.count.mockResolvedValueOnce(1)

    const res = await DELETE(makeRequest(), params())

    expect(res.status).toBe(400)
    expect(environment.delete).not.toHaveBeenCalled()
  })
})
