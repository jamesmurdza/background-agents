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

// CODEX_SUBSCRIPTION_ENABLED is read from process.env at module-eval time and
// is off in CI, which would freeze applyCodexSubscription's guard on one
// branch. Keep every other export real (parseCodexCredential /
// buildCodexAuthJson are load-bearing here) and make just the flag a live
// getter so both branches are genuinely exercised.
const codexFlagState = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/codex-credentials", async () => {
  const actual = await vi.importActual<typeof import("@/lib/codex-credentials")>(
    "@/lib/codex-credentials"
  )
  return {
    ...actual,
    get CODEX_SUBSCRIPTION_ENABLED() {
      return codexFlagState.enabled
    },
  }
})

import {
  resolveCodexAuthJson,
  applyCodexSubscription,
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
  codexFlagState.enabled = true
})

/**
 * The one invariant this whole module exists for: the REAL refresh token must
 * never appear in the credentials handed to a sandbox.
 *
 * `getUserCredentials` decrypts CODEX_CREDENTIALS like any other credential,
 * so what arrives here is the stored blob containing the live grant. Every
 * assertion below searches the SERIALIZED credentials for the secret rather
 * than merely checking that the key is undefined — the leak is about the
 * value, not the key name.
 *
 * Verified by mutation: commenting out the `delete next.CODEX_CREDENTIALS`
 * line in applyCodexSubscription makes the flag-off, no-subscription,
 * non-codex and custom-endpoint cases below all fail.
 */
describe("applyCodexSubscription", () => {
  const REAL = "rt.REAL-USER-GRANT-MUST-NOT-LEAK"

  /** What getUserCredentials returns for a connected user: the decrypted blob. */
  function storedBlob(overrides: Partial<CodexStoredCredential> = {}) {
    return JSON.stringify(cred({ refresh_token: REAL, ...overrides }))
  }

  const leaks = (creds: unknown) => JSON.stringify(creds).includes(REAL)

  it("strips the stored blob when the feature flag is off", async () => {
    codexFlagState.enabled = false
    await storeCodexCredential("u1", cred({ refresh_token: REAL }))
    const out = await applyCodexSubscription(
      { OPENAI_API_KEY: "sk-1", CODEX_CREDENTIALS: storedBlob() },
      "u1",
      "codex",
      "gpt-5.1-codex"
    )
    expect(leaks(out)).toBe(false)
    expect(out.CODEX_CREDENTIALS).toBeUndefined()
    expect(out.OPENAI_API_KEY).toBe("sk-1")
  })

  it("strips the stored blob when the user has no usable subscription", async () => {
    // needs_reconnect: resolveCodexAuthJson returns null, but the row (and the
    // still-live refresh token in it) is deliberately kept.
    await storeCodexCredential("u1", cred({ refresh_token: REAL, status: "needs_reconnect" }))
    const out = await applyCodexSubscription(
      { CODEX_CREDENTIALS: storedBlob({ status: "needs_reconnect" }) },
      "u1",
      "codex",
      "gpt-5.1-codex"
    )
    expect(leaks(out)).toBe(false)
    expect(out.CODEX_CREDENTIALS).toBeUndefined()
  })

  it("strips the stored blob for a non-codex agent", async () => {
    await storeCodexCredential("u1", cred({ refresh_token: REAL }))
    const out = await applyCodexSubscription(
      { CODEX_CREDENTIALS: storedBlob() },
      "u1",
      "claude-code",
      "sonnet"
    )
    expect(leaks(out)).toBe(false)
  })

  it("strips the stored blob for a custom codex endpoint", async () => {
    await storeCodexCredential("u1", cred({ refresh_token: REAL }))
    const out = await applyCodexSubscription(
      { CODEX_CREDENTIALS: storedBlob() },
      "u1",
      "codex",
      "endpoint:c1"
    )
    expect(leaks(out)).toBe(false)
  })

  it("re-adds a rendered auth.json carrying the placeholder, never the real token", async () => {
    await storeCodexCredential("u1", cred({ refresh_token: REAL }))
    const out = await applyCodexSubscription(
      { CODEX_CREDENTIALS: storedBlob() },
      "u1",
      "codex",
      "gpt-5.1-codex"
    )
    expect(leaks(out)).toBe(false)
    expect(out.CODEX_CREDENTIALS).toContain(CODEX_PLACEHOLDER_REFRESH_TOKEN)
  })

  it("leaves every other credential untouched", async () => {
    const out = await applyCodexSubscription(
      { OPENAI_API_KEY: "sk-1", ANTHROPIC_API_KEY: "sk-ant" },
      "u1",
      "codex",
      "gpt-5.1-codex"
    )
    expect(out.OPENAI_API_KEY).toBe("sk-1")
    expect(out.ANTHROPIC_API_KEY).toBe("sk-ant")
  })
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

  it("reports 'transient_failure', not 'needs_reconnect', when the outage hits an already-expired token", async () => {
    // The DB was not mutated here — the grant may well be perfectly alive and
    // OpenAI simply unavailable. Reporting needs_reconnect would tell the
    // operator the user has to redo device-code login, which is a lie.
    await storeCodexCredential("u1", cred({ expires_at: nowSec() - 10, earliest_refresh_at: nowSec() - 100 }))
    refreshCodexTokens.mockRejectedValue(new Error("HTTP 503"))
    expect(await refreshCodexCredentialForUser("u1")).toBe("transient_failure")
    expect((await readCodexCredential("u1"))?.status).toBe("connected")
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
