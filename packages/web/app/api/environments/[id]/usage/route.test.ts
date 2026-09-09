import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { environment, chat } = vi.hoisted(() => ({
  environment: { findFirst: vi.fn() },
  chat: { count: vi.fn() },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { environment, chat } }))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  notFound: vi.fn((message: string) => Response.json({ error: message }, { status: 404 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 })
  ),
}))

import { GET } from "./route"

function makeRequest() {
  return new Request("http://localhost/api/environments/env_1/usage") as unknown as import(
    "next/server"
  ).NextRequest
}

function params(id = "env_1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  environment.findFirst.mockReset()
  chat.count.mockReset()
})

describe("GET /api/environments/[id]/usage", () => {
  it("404s for an environment the caller does not own", async () => {
    environment.findFirst.mockResolvedValueOnce(null)

    const res = await GET(makeRequest(), params())

    expect(res.status).toBe(404)
    expect(chat.count).not.toHaveBeenCalled()
  })

  it("counts the caller's chats pinned to this environment", async () => {
    environment.findFirst.mockResolvedValueOnce({ id: "env_1" })
    chat.count.mockResolvedValueOnce(3)

    const res = await GET(makeRequest(), params())
    const body = await res.json()

    expect(chat.count).toHaveBeenCalledWith({ where: { userId: "u1", environmentId: "env_1" } })
    expect(body).toEqual({ chatCount: 3 })
  })
})
