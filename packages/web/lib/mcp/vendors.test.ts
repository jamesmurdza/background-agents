import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * An in-memory McpCredential table that honours the same where-clauses
 * getVendorAccessToken relies on, so the refresh lock can be tested with two
 * runs racing for real.
 */
interface TokenRow {
  id: string
  userId: string
  provider: string
  refreshTokenEncrypted: string
  accessTokenEncrypted: string | null
  accessTokenExpiresAt: Date | null
  refreshLockedUntil: Date | null
  client: { id: string; clientId: string; clientSecretEncrypted: string | null; authMethod: string }
}

const mocks = vi.hoisted(() => ({
  rows: [] as TokenRow[],
  refresh: vi.fn(),
  deleteClients: vi.fn(),
}))

vi.mock("@/lib/db/encryption", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
}))

vi.mock("@/lib/db/prisma", () => {
  const find = (where: { userId_provider: { userId: string; provider: string } }) =>
    mocks.rows.find((r) => r.userId === where.userId_provider.userId && r.provider === where.userId_provider.provider)
  return {
    prisma: {
      mcpCredential: {
        findUnique: vi.fn(async ({ where }) => {
          const row = find(where)
          return row ? { ...row, client: { ...row.client } } : null
        }),
        updateMany: vi.fn(async ({ where, data }) => {
          const now = Date.now()
          const matches = mocks.rows.filter(
            (r) =>
              r.id === where.id &&
              (where.refreshTokenEncrypted === undefined || r.refreshTokenEncrypted === where.refreshTokenEncrypted) &&
              (where.OR === undefined || r.refreshLockedUntil === null || r.refreshLockedUntil.getTime() < now)
          )
          for (const r of matches) Object.assign(r, data)
          return { count: matches.length }
        }),
        update: vi.fn(async ({ where, data }) => {
          const row = mocks.rows.find((r) => r.id === where.id)
          if (!row) throw new Error("not found")
          Object.assign(row, data)
          return row
        }),
        deleteMany: vi.fn(async ({ where }) => {
          const before = mocks.rows.length
          mocks.rows = mocks.rows.filter((r) => r.id !== where.id)
          return { count: before - mocks.rows.length }
        }),
      },
      mcpOAuthClient: { deleteMany: mocks.deleteClients },
    },
  }
})

vi.mock("@background-agents/mcp", async (original) => ({
  ...(await original<typeof import("@background-agents/mcp")>()),
  createVendorOAuth: () => ({ refresh: mocks.refresh }),
}))

import { findMcpVendor, McpOAuthError } from "@background-agents/mcp"
import { getVendorAccessToken } from "./vendors"

const linear = findMcpVendor("linear")!
const HOUR = 60 * 60 * 1000

function seed(overrides: Partial<TokenRow> = {}): TokenRow {
  const row: TokenRow = {
    id: "token-1",
    userId: "user-1",
    provider: "linear",
    refreshTokenEncrypted: "enc:refresh-1",
    accessTokenEncrypted: "enc:access-1",
    accessTokenExpiresAt: new Date(Date.now() + HOUR),
    refreshLockedUntil: null,
    client: { id: "client-row-1", clientId: "client-1", clientSecretEncrypted: null, authMethod: "none" },
    ...overrides,
  }
  mocks.rows = [row]
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("MCP_OAUTH_STATE_SECRET", "test-secret")
})

describe("getVendorAccessToken", () => {
  it("reuses a stored access token that isn't about to expire", async () => {
    seed()
    await expect(getVendorAccessToken("user-1", linear)).resolves.toBe("access-1")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("refreshes an expiring token and stores the rotated refresh token", async () => {
    const row = seed({ accessTokenExpiresAt: new Date(Date.now() + 60_000) })
    mocks.refresh.mockResolvedValue({ accessToken: "access-2", expiresAt: Date.now() + HOUR, refreshToken: "refresh-2" })

    await expect(getVendorAccessToken("user-1", linear)).resolves.toBe("access-2")
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      { clientId: "client-1", clientSecret: null, authMethod: "none" },
      "refresh-1"
    )
    expect(row).toMatchObject({
      refreshTokenEncrypted: "enc:refresh-2",
      accessTokenEncrypted: "enc:access-2",
      refreshLockedUntil: null,
    })
  })

  it("lets only one of two simultaneous runs refresh", async () => {
    seed({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
    mocks.refresh.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { accessToken: "access-2", expiresAt: Date.now() + HOUR, refreshToken: "refresh-2" }
    })

    const [a, b] = await Promise.all([
      getVendorAccessToken("user-1", linear),
      getVendorAccessToken("user-1", linear),
    ])
    expect([a, b]).toEqual(["access-2", "access-2"])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("releases the lock when the refresh fails, and forgets a client the server rejects", async () => {
    const row = seed({ accessTokenExpiresAt: null })
    mocks.refresh.mockRejectedValue(new McpOAuthError("Token request failed", "invalid_client"))

    await expect(getVendorAccessToken("user-1", linear)).rejects.toThrow("Token request failed")
    expect(row.refreshLockedUntil).toBeNull()
    expect(mocks.deleteClients).toHaveBeenCalledWith({ where: { id: "client-row-1" } })
  })

  it("forgets a grant the user revoked so the vendor shows as not connected", async () => {
    seed({ accessTokenExpiresAt: null })
    mocks.refresh.mockRejectedValue(new McpOAuthError("Token request failed", "invalid_grant"))

    await expect(getVendorAccessToken("user-1", linear)).rejects.toThrow("Reconnect it in Settings")
    expect(mocks.rows).toEqual([])
    expect(mocks.deleteClients).not.toHaveBeenCalled()
  })

  it("says so when the user never connected the vendor", async () => {
    mocks.rows = []
    await expect(getVendorAccessToken("user-1", linear)).rejects.toThrow("Linear account not connected")
  })
})
