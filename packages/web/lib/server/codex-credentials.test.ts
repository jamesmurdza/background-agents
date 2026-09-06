import { describe, it, expect, vi, beforeEach } from "vitest"

const { refreshCodexTokens, revokeCodexToken } = vi.hoisted(() => ({
  refreshCodexTokens: vi.fn(),
  revokeCodexToken: vi.fn().mockResolvedValue(true),
}))

vi.mock("./codex-oauth", async () => {
  const actual = await vi.importActual<typeof import("./codex-oauth")>("./codex-oauth")
  return { ...actual, refreshCodexTokens, revokeCodexToken }
})

// In-memory stand-in for the User.credentials JSONB column, plus the mutable
// bits tests use to steer the mock's behavior (a per-user lock map, and a
// one-shot failure to inject into `user.update`).
const testState = vi.hoisted(() => ({
  store: new Map<string, Record<string, string>>(),
  locks: new Map<string, Promise<unknown>>(),
  failNextUpdate: null as Error | null,
}))

/**
 * Locking is keyed by userId and only engaged when `$queryRaw` is actually
 * called — i.e. only transactions that call `withUserLock`'s row lock
 * serialize against each other for that user. This mock reproduces the
 * concurrency behavior `SELECT ... FOR UPDATE` gives us in real Postgres:
 * two transactions racing to lock the SAME user's row run one at a time;
 * transactions for different users, or a transaction that never locks
 * (a plain read), do not wait on each other at all.
 *
 * This is deliberately lock-aware rather than a blanket "serialize every
 * transaction" stand-in: an earlier version of this mock serialized every
 * `$transaction` call unconditionally, which accidentally granted mutual
 * exclusion the implementation never asked for — deleting `lockUser` from
 * the real module left every test passing. Verified directly against this
 * version: the race test below passes against the real implementation, and
 * fails (refreshCodexTokens called more than once) when `lockUserRow`'s call
 * is temporarily removed from codex-credentials.ts. Reading the credential
 * OUTSIDE the transaction still breaks the race test too, which is the other
 * property this suite exists to catch.
 */
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown, _options?: unknown) => {
      // Held in an object (not a bare closure variable) so a release set
      // deep inside `$queryRaw` is visible in the `finally` below without
      // TS narrowing the outer binding back to its initial `null`.
      const released: { fn: (() => void) | null } = { fn: null }
      const tx = {
        $queryRaw: async (_strings: TemplateStringsArray, ...vals: string[]) => {
          const uid = vals[0]
          const prev = testState.locks.get(uid) ?? Promise.resolve()
          let resolveMine: () => void = () => {}
          const mine = new Promise<void>((resolve) => {
            resolveMine = resolve
          })
          testState.locks.set(
            uid,
            prev.then(() => mine)
          )
          await prev
          released.fn = resolveMine
          return [{ id: uid }]
        },
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            credentials: testState.store.get(where.id) ?? null,
          }),
          update: async ({
            where,
            data,
          }: {
            where: { id: string }
            data: { credentials: Record<string, string> }
          }) => {
            if (testState.failNextUpdate) {
              const err = testState.failNextUpdate
              testState.failNextUpdate = null
              throw err
            }
            testState.store.set(where.id, data.credentials)
          },
        },
      }
      return (async () => {
        try {
          return await fn(tx)
        } finally {
          released.fn?.()
        }
      })()
    },
  },
}))

import {
  resolveCodexAuthJson,
  storeCodexCredential,
  readCodexCredential,
  disconnectCodex,
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
  testState.store.clear()
  testState.locks.clear()
  testState.failNextUpdate = null
  refreshCodexTokens.mockReset()
  revokeCodexToken.mockReset().mockResolvedValue(true)
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

  it("propagates a write failure after a successful refresh instead of mislabeling it transient", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockResolvedValue({
      access_token: "at.fresh",
      refresh_token: "rt.rotated",
      id_token: "id.fresh",
      expires_in: 864000,
      earliest_refresh_at: nowSec() + 777600,
    })
    testState.failNextUpdate = new Error("db write failed")

    await expect(resolveCodexAuthJson("u1")).rejects.toThrow("db write failed")

    // The write never landed, so what's on disk is whatever storeCodexCredential
    // wrote at the top of this test — untouched, and NOT marked needs_reconnect:
    // a lost write here is not a terminal OAuth failure.
    const stored = await readCodexCredential("u1")
    expect(stored?.status).toBe("connected")
    expect(stored?.refresh_token).toBe("rt.stored")
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

  it("reports 'transient_failure' rather than 'skipped' when refresh fails transiently on a still-valid token", async () => {
    await storeCodexCredential("u1", cred({ earliest_refresh_at: nowSec() - 1 }))
    refreshCodexTokens.mockRejectedValue(new Error("HTTP 503"))
    expect(await refreshCodexCredentialForUser("u1")).toBe("transient_failure")
  })
})

describe("disconnectCodex", () => {
  it("deletes the stored credential", async () => {
    await storeCodexCredential("u1", cred())
    await disconnectCodex("u1")
    expect(await readCodexCredential("u1")).toBeNull()
  })

  it("revokes the stored refresh token", async () => {
    await storeCodexCredential("u1", cred({ refresh_token: "rt.to-revoke" }))
    await disconnectCodex("u1")
    expect(revokeCodexToken).toHaveBeenCalledWith("rt.to-revoke")
  })

  it("still succeeds when revocation fails", async () => {
    await storeCodexCredential("u1", cred())
    revokeCodexToken.mockResolvedValue(false)
    await expect(disconnectCodex("u1")).resolves.toBeUndefined()
    expect(await readCodexCredential("u1")).toBeNull()
  })

  it("is a no-op (no revocation call) when there is nothing stored", async () => {
    await disconnectCodex("u1")
    expect(revokeCodexToken).not.toHaveBeenCalled()
  })
})
