import { describe, it, expect, vi, beforeEach } from "vitest"

// `vi.hoisted` lets the factory (which is hoisted above imports) see these.
const { refreshCodexTokens, revokeCodexToken } = vi.hoisted(() => ({
  refreshCodexTokens: vi.fn(),
  revokeCodexToken: vi.fn().mockResolvedValue(true),
}))

vi.mock("./codex-oauth", async () => {
  const actual = await vi.importActual<typeof import("./codex-oauth")>("./codex-oauth")
  return { ...actual, refreshCodexTokens, revokeCodexToken }
})

// In-memory stand-in for the User.credentials JSONB column.
const store = new Map<string, Record<string, string>>()

/**
 * Transactions are serialized here on purpose. `SELECT ... FOR UPDATE` makes
 * concurrent transactions for one user run one at a time in Postgres, and the
 * race test below is only meaningful against a mock that reproduces that. If
 * transactions were allowed to interleave, the second caller would read the
 * pre-refresh credential and refresh again — which is exactly the bug the real
 * lock prevents.
 */
let txChain: Promise<unknown> = Promise.resolve()

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => {
      const run = txChain.then(() =>
        fn({
          $queryRaw: async () => [{ id: "u1" }],
          user: {
            findUnique: async ({ where }: { where: { id: string } }) => ({
              credentials: store.get(where.id) ?? null,
            }),
            update: async ({
              where,
              data,
            }: {
              where: { id: string }
              data: { credentials: Record<string, string> }
            }) => {
              store.set(where.id, data.credentials)
            },
          },
        })
      )
      // Keep the chain alive regardless of outcome, or one rejection would
      // wedge every later transaction in the suite.
      txChain = run.catch(() => undefined)
      return run
    },
  },
}))

import {
  resolveCodexAuthJson,
  storeCodexCredential,
  readCodexCredential,
  refreshCodexCredentialForUser,
} from "./codex-credentials"
import { CodexReconnectRequiredError } from "./codex-oauth"
import { CODEX_PLACEHOLDER_REFRESH_TOKEN, type CodexStoredCredential } from "@/lib/codex-credentials"

const nowSec = () => Math.floor(Date.now() / 1000)

function cred(overrides: Partial<CodexStoredCredential> = {}): CodexStoredCredential {
  return {
    refresh_token: "rt.stored",
    access_token: "at.stored",
    id_token: "id.stored",
    account_id: "acct-1",
    expires_at: nowSec() + 864000,
    earliest_refresh_at: nowSec() + 777600,
    last_refresh: new Date().toISOString(),
    status: "connected",
    ...overrides,
  }
}

beforeEach(() => {
  store.clear()
  txChain = Promise.resolve()
  refreshCodexTokens.mockReset()
})

describe("resolveCodexAuthJson", () => {
  it("returns null when the user has no subscription stored", async () => {
    expect(await resolveCodexAuthJson("u1")).toBeNull()
  })

  it("injects a placeholder refresh token, never the stored one", async () => {
    await storeCodexCredential("u1", cred())
    const blob = await resolveCodexAuthJson("u1")
    expect(blob).not.toBeNull()
    const parsed = JSON.parse(blob!)
    expect(parsed.tokens.access_token).toBe("at.stored")
    expect(parsed.tokens.refresh_token).toBe(CODEX_PLACEHOLDER_REFRESH_TOKEN)
    expect(blob).not.toContain("rt.stored")
  })

  it("does not refresh a credential inside its window", async () => {
    await storeCodexCredential("u1", cred())
    await resolveCodexAuthJson("u1")
    expect(refreshCodexTokens).not.toHaveBeenCalled()
  })

  it("refreshes once past earliest_refresh_at and persists the rotated token", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockResolvedValue({
      access_token: "at.fresh",
      refresh_token: "rt.rotated",
      id_token: "id.fresh",
      expires_in: 864000,
      earliest_refresh_at: nowSec() + 777600,
    })

    const blob = await resolveCodexAuthJson("u1")
    expect(JSON.parse(blob!).tokens.access_token).toBe("at.fresh")

    const stored = await readCodexCredential("u1")
    expect(stored?.refresh_token).toBe("rt.rotated")
  })

  it("refreshes exactly once when two callers race", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockResolvedValue({
      access_token: "at.fresh",
      refresh_token: "rt.rotated",
      id_token: "id.fresh",
      expires_in: 864000,
      earliest_refresh_at: nowSec() + 777600,
    })

    const [a, b] = await Promise.all([resolveCodexAuthJson("u1"), resolveCodexAuthJson("u1")])

    expect(refreshCodexTokens).toHaveBeenCalledTimes(1)
    expect(JSON.parse(a!).tokens.access_token).toBe("at.fresh")
    expect(JSON.parse(b!).tokens.access_token).toBe("at.fresh")
  })

  it("marks needs_reconnect and returns null on a terminal refresh failure", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockRejectedValue(new CodexReconnectRequiredError("invalid_grant"))

    expect(await resolveCodexAuthJson("u1")).toBeNull()
    expect((await readCodexCredential("u1"))?.status).toBe("needs_reconnect")
  })

  it("never resurrects a credential already marked needs_reconnect", async () => {
    await storeCodexCredential("u1", cred({ status: "needs_reconnect" }))
    expect(await resolveCodexAuthJson("u1")).toBeNull()
    expect(refreshCodexTokens).not.toHaveBeenCalled()
  })

  it("leaves the credential usable when a refresh fails transiently and the token is still valid", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockRejectedValue(new Error("HTTP 503"))

    const blob = await resolveCodexAuthJson("u1")
    expect(JSON.parse(blob!).tokens.access_token).toBe("at.stored")
    expect((await readCodexCredential("u1"))?.status).toBe("connected")
  })
})

describe("refreshCodexCredentialForUser", () => {
  it("reports 'absent' for a user with no subscription", async () => {
    expect(await refreshCodexCredentialForUser("u1")).toBe("absent")
  })

  it("reports 'skipped' inside the window", async () => {
    await storeCodexCredential("u1", cred())
    expect(await refreshCodexCredentialForUser("u1")).toBe("skipped")
  })

  it("reports 'needs_reconnect' on a terminal failure", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockRejectedValue(new CodexReconnectRequiredError("invalid_grant"))
    expect(await refreshCodexCredentialForUser("u1")).toBe("needs_reconnect")
  })
})
