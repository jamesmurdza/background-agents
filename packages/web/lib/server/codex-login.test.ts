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

// Real output from `codex login --device-auth`, ANSI colour codes included.
const REAL_OUTPUT = `Welcome to Codex [v[90m0.153.4[0m]
[90mOpenAI's command-line coding agent[0m

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   [94mhttps://auth.openai.com/codex/device[0m

2. Enter this one-time code [90m(expires in 15 minutes)[0m
   [94mX2BM-0QC5V[0m
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
    expect(hasCliStarted("Welcome to Codex [v[90m0.153.4[0m]\n[90mOpenAI's command-line coding agent[0m\n")).toBe(
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

  it("returns unknown_session for a stale sessionId, without touching Daytona", async () => {
    seedSession()

    const result = await pollCodexDeviceLogin(USER_ID, "some-other-session")

    expect(result).toEqual({ status: "failed", reason: "unknown_session" })
    expect(daytonaGet).not.toHaveBeenCalled()
  })
})
