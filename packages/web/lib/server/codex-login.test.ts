import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// parseDeviceCodePrompt / classifyDeviceAuthFailure / hasCliStarted are pure,
// but importing the module still pulls in @/lib/db/prisma, "./codex-oauth",
// "./codex-credentials", and "@daytonaio/sdk" transitively. Prisma throws at
// import time when DATABASE_URL isn't set, so it must be stubbed even for the
// pure-function tests (same pattern as lib/server/codex-credentials.test.ts).
// The others are stubbed with controllable fakes so pollCodexDeviceLogin can
// be exercised end-to-end without touching a real database or Daytona.

// In-memory stand-in for the CcAuthInfo table, keyed by row id.
const ccAuthStore = vi.hoisted(() => new Map<string, string>())

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ccAuthInfo: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const value = ccAuthStore.get(where.id)
        return value === undefined ? null : { value }
      }),
      upsert: vi.fn(async ({ where, create }: { where: { id: string }; create: { value: string } }) => {
        ccAuthStore.set(where.id, create.value)
        return { id: where.id, value: create.value }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        ccAuthStore.delete(where.id)
      }),
      // Honours the `value` filter, which is the whole point of the claim:
      // the delete only lands when the row still holds exactly what the
      // caller read, so a second poll (or a superseding login) cannot claim
      // a session it did not observe.
      deleteMany: vi.fn(
        async ({ where }: { where: { id: string; value?: string } }) => {
          const current = ccAuthStore.get(where.id)
          if (current === undefined) return { count: 0 }
          if (where.value !== undefined && current !== where.value) return { count: 0 }
          ccAuthStore.delete(where.id)
          return { count: 1 }
        }
      ),
    },
    user: {},
    $transaction: vi.fn(),
  },
}))

const refreshCodexTokens = vi.hoisted(() => vi.fn())
vi.mock("./codex-oauth", () => ({ refreshCodexTokens }))

const storeCodexCredential = vi.hoisted(() => vi.fn())
vi.mock("./codex-credentials", () => ({ storeCodexCredential }))

const daytonaGet = vi.hoisted(() => vi.fn())
vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn().mockImplementation(() => ({ get: daytonaGet })),
}))

import {
  parseDeviceCodePrompt,
  classifyDeviceAuthFailure,
  hasCliStarted,
  pollCodexDeviceLogin,
} from "./codex-login"

// Real output from `codex login --device-auth`, ANSI colour codes included —
// with the actual ESC (0x1b) bytes, which is what makes this a real test of
// stripAnsi. Written with literal `[90m`-style brackets and no ESC, every
// assertion below still passed against a stripAnsi regex that could not
// strip a real escape sequence at all.
const REAL_OUTPUT = `Welcome to Codex [v\x1b[90m0.153.4\x1b[0m]
\x1b[90mOpenAI's command-line coding agent\x1b[0m

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m

2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m
   \x1b[94mX2BM-0QC5V\x1b[0m
`

describe("parseDeviceCodePrompt", () => {
  it("extracts the URL and code from real CLI output with ANSI codes", () => {
    expect(parseDeviceCodePrompt(REAL_OUTPUT)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "X2BM-0QC5V",
    })
  })

  it("returns null before the CLI has printed the prompt", () => {
    expect(parseDeviceCodePrompt("Welcome to Codex\n")).toBeNull()
  })
})

describe("classifyDeviceAuthFailure", () => {
  it("recognises the account-level toggle being off", () => {
    expect(classifyDeviceAuthFailure("error: device code login is not enabled for this account")).toBe(
      "device_auth_disabled"
    )
  })

  it("recognises a workspace admin policy block", () => {
    expect(
      classifyDeviceAuthFailure("Device code authorization is disabled by your workspace admin")
    ).toBe("admin_blocked")
  })

  it("falls back to unknown", () => {
    expect(classifyDeviceAuthFailure("connection reset by peer")).toBe("unknown")
  })
})

describe("hasCliStarted", () => {
  it("is true once the CLI has printed its startup banner, even with no prompt yet", () => {
    expect(
      hasCliStarted(
        "Welcome to Codex [v\x1b[90m0.153.4\x1b[0m]\n\x1b[90mOpenAI's command-line coding agent\x1b[0m\n"
      )
    ).toBe(
      true
    )
  })

  it("is false when the CLI has produced no output at all", () => {
    expect(hasCliStarted("")).toBe(false)
    expect(hasCliStarted("   \n")).toBe(false)
  })
})

describe("pollCodexDeviceLogin", () => {
  const USER_ID = "user-1"
  const SESSION_ID = "sess-1"
  const AUTH_JSON = JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      refresh_token: "rt-old",
      access_token: "at-old",
      id_token: "it-old",
      account_id: "acct-1",
    },
    last_refresh: new Date().toISOString(),
  })

  function seedSession() {
    ccAuthStore.set(
      "codex-login:user-1",
      JSON.stringify({ sandboxId: "sbx-1", startedAt: Date.now(), sessionId: SESSION_ID })
    )
  }

  function makeSandbox(authFileContent: string) {
    return {
      process: {
        executeCommand: vi.fn(async () => ({ result: authFileContent })),
      },
      delete: vi.fn().mockResolvedValue(undefined),
    }
  }

  beforeEach(() => {
    ccAuthStore.clear()
    refreshCodexTokens.mockReset()
    storeCodexCredential.mockReset()
    daytonaGet.mockReset()
  })

  it("retries storeCodexCredential and reports connected once it eventually succeeds", async () => {
    seedSession()
    const sandbox = makeSandbox(AUTH_JSON)
    daytonaGet.mockResolvedValue(sandbox)
    refreshCodexTokens.mockResolvedValue({
      access_token: "at-new",
      refresh_token: "rt-new",
      id_token: "it-new",
      expires_in: 3600,
    })
    storeCodexCredential
      .mockRejectedValueOnce(new Error("transient DB failure"))
      .mockResolvedValueOnce(undefined)

    const result = await pollCodexDeviceLogin(USER_ID, SESSION_ID)

    expect(result).toEqual({ status: "connected" })
    expect(storeCodexCredential).toHaveBeenCalledTimes(2)
    expect(storeCodexCredential.mock.calls[1][1]).toMatchObject({ refresh_token: "rt-new" })
    // Cleanup still ran: the row is gone and the sandbox was deleted.
    expect(ccAuthStore.has("codex-login:user-1")).toBe(false)
    expect(sandbox.delete).toHaveBeenCalledTimes(1)
  })

  it("reports credential_lost (not refresh_failed) when every store attempt fails, and still cleans up", async () => {
    seedSession()
    const sandbox = makeSandbox(AUTH_JSON)
    daytonaGet.mockResolvedValue(sandbox)
    refreshCodexTokens.mockResolvedValue({
      access_token: "at-new",
      refresh_token: "rt-new",
      id_token: "it-new",
      expires_in: 3600,
    })
    storeCodexCredential.mockRejectedValue(new Error("DB is down"))

    const result = await pollCodexDeviceLogin(USER_ID, SESSION_ID)

    expect(result).toEqual({ status: "failed", reason: "credential_lost" })
    expect(storeCodexCredential).toHaveBeenCalledTimes(3)
    expect(ccAuthStore.has("codex-login:user-1")).toBe(false)
    expect(sandbox.delete).toHaveBeenCalledTimes(1)
  })

  it("fails closed with sandbox_unavailable and still cleans up when the sandbox can't be reached", async () => {
    seedSession()
    daytonaGet.mockRejectedValue(new Error("Daytona is unreachable"))

    const result = await pollCodexDeviceLogin(USER_ID, SESSION_ID)

    expect(result).toEqual({ status: "failed", reason: "sandbox_unavailable" })
    expect(ccAuthStore.has("codex-login:user-1")).toBe(false)
  })

  it("lets only one of two overlapping polls spend the single-use refresh token", async () => {
    // The client polls every 2s while a poll's own fetch is bounded at 8s, so
    // overlap is routine — and two tabs can share a sessionId. The refresh
    // token the CLI wrote is single-use: a second refresh of it comes back
    // invalid_grant / refresh_token_reused, which this module treats as
    // terminal, so an unclaimed double-spend destroys a login the user just
    // completed. The loser must back off as "pending" AND must not tear down
    // the winner's sandbox.
    seedSession()
    const sandbox = makeSandbox(AUTH_JSON)
    daytonaGet.mockResolvedValue(sandbox)
    refreshCodexTokens.mockResolvedValue({
      access_token: "at-new",
      refresh_token: "rt-new",
      id_token: "it-new",
      expires_in: 3600,
    })
    storeCodexCredential.mockResolvedValue(undefined)

    const first = await pollCodexDeviceLogin(USER_ID, SESSION_ID)
    expect(first).toEqual({ status: "connected" })

    // Simulate the overlapping poll: it read the same session row before the
    // winner claimed it, so re-seed and re-run against a row the winner has
    // already consumed.
    const claimedRow = ccAuthStore.get("codex-login:user-1")
    expect(claimedRow).toBeUndefined()

    refreshCodexTokens.mockClear()
    storeCodexCredential.mockClear()
    sandbox.delete.mockClear()

    const second = await pollCodexDeviceLogin(USER_ID, SESSION_ID)
    // The winner already consumed the row, so this poll never even reaches the
    // claim: it falls out at the superseded-session check with unknown_session,
    // which is the pre-existing behavior for a poll whose session is gone. What
    // matters is that it spends nothing and leaves the sandbox alone.
    expect(second).toEqual({ status: "failed", reason: "unknown_session" })
    expect(refreshCodexTokens).not.toHaveBeenCalled()
    expect(storeCodexCredential).not.toHaveBeenCalled()
    expect(sandbox.delete).not.toHaveBeenCalled()
  })

  it("returns pending, spends nothing, and spares the winner's sandbox when it loses the claim", async () => {
    // The precise race: both polls read the SAME live row, then a winner
    // claims it between this caller's read and its own claim. Modelled by
    // dropping the row while the auth.json read is in flight.
    seedSession()
    const sandbox = {
      process: {
        executeCommand: vi.fn(async () => {
          // The winner claims (deletes) the row right here.
          ccAuthStore.delete("codex-login:user-1")
          return { result: AUTH_JSON }
        }),
      },
      delete: vi.fn().mockResolvedValue(undefined),
    }
    daytonaGet.mockResolvedValue(sandbox)

    const result = await pollCodexDeviceLogin(USER_ID, SESSION_ID)

    expect(result).toEqual({ status: "pending" })
    expect(refreshCodexTokens).not.toHaveBeenCalled()
    expect(storeCodexCredential).not.toHaveBeenCalled()
    // Critically: the loser does NOT tear down the sandbox the winner is using.
    expect(sandbox.delete).not.toHaveBeenCalled()
  })

  it("returns unknown_session for a stale sessionId, without touching Daytona", async () => {
    seedSession()

    const result = await pollCodexDeviceLogin(USER_ID, "some-other-session")

    expect(result).toEqual({ status: "failed", reason: "unknown_session" })
    expect(daytonaGet).not.toHaveBeenCalled()
  })
})
