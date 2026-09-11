import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * These tests deliberately run the REAL `applyCodexSubscription` (and the real
 * `resolveCodexAuthJson` behind it), stubbing only Prisma and encryption.
 *
 * An earlier version of this suite mocked `@/lib/server/codex-credentials`
 * wholesale and fed `getUserCredentials` a tidy `{ OPENAI_API_KEY: "sk-1" }`.
 * That is what let the leak ship: in production `getUserCredentials` also
 * returns the decrypted CODEX_CREDENTIALS blob — the user's REAL refresh
 * token — and the injection site only ever *overwrote* it conditionally, so
 * every path where the condition didn't fire shipped the raw grant into the
 * sandbox. The mock encoded the false assumption, so no test could see it.
 *
 * Here the incoming credentials always carry a recognizable secret, and every
 * case asserts on the SERIALIZED output, not just on the key being unset.
 */

// In-memory stand-in for User.credentials, driving resolveCodexAuthJson.
const testState = vi.hoisted(() => ({ store: new Map<string, Record<string, string>>() }))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: async () => [],
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
            testState.store.set(where.id, data.credentials)
          },
        },
      }),
  },
}))

// Identity encryption: these tests are about which VALUES travel, not about
// the cipher.
vi.mock("@/lib/db/encryption", () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}))

const refreshCodexTokens = vi.hoisted(() => vi.fn())
vi.mock("@/lib/server/codex-oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/codex-oauth")>(
    "@/lib/server/codex-oauth"
  )
  return { ...actual, refreshCodexTokens, revokeCodexToken: vi.fn() }
})

vi.mock("@/lib/db/api-helpers", () => ({
  getGitHubToken: vi.fn().mockResolvedValue("gh-token"),
  getUserCredentials: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/db/activity-log", () => ({ logActivityAsync: vi.fn() }))
vi.mock("@/lib/db/usage-limit", () => ({
  checkSharedPoolUsage: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock("@/lib/claude-credentials", () => ({ getClaudeCredentials: vi.fn() }))

import { resolveSendCredentials } from "./resolve-credentials"
import { getUserCredentials } from "@/lib/db/api-helpers"
import {
  CODEX_PLACEHOLDER_REFRESH_TOKEN,
  type CodexStoredCredential,
} from "@/lib/codex-credentials"

/** The value that must never reach a sandbox. */
const REAL_REFRESH_TOKEN = "rt.REAL-USER-GRANT-MUST-NOT-LEAK"

const nowSec = () => Math.floor(Date.now() / 1000)

function storedCredential(
  overrides: Partial<CodexStoredCredential> = {}
): CodexStoredCredential {
  return {
    refresh_token: REAL_REFRESH_TOKEN,
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

/**
 * Seed the DB row AND the decrypted credentials map the same way production
 * does: `getUserCredentials` hands the caller the full stored blob, real
 * refresh token and all.
 */
function seedSubscription(overrides: Partial<CodexStoredCredential> = {}) {
  const blob = JSON.stringify(storedCredential(overrides))
  testState.store.set("u1", { CODEX_CREDENTIALS: blob })
  vi.mocked(getUserCredentials).mockResolvedValue({
    OPENAI_API_KEY: "sk-1",
    CODEX_CREDENTIALS: blob,
  })
}

function credentialsOf(out: unknown) {
  if (!(out && typeof out === "object" && "credentials" in out)) {
    throw new Error("expected resolved credentials, got a Response")
  }
  return (out as { credentials: Record<string, string | undefined> }).credentials
}

const leaks = (creds: unknown) => JSON.stringify(creds).includes(REAL_REFRESH_TOKEN)

beforeEach(() => {
  testState.store.clear()
  refreshCodexTokens.mockReset()
  vi.mocked(getUserCredentials).mockResolvedValue({})
})

describe("resolveSendCredentials never ships the real Codex refresh token", () => {
  it("strips the stored blob when the credential needs reconnecting (auth.json resolves to null)", async () => {
    // needs_reconnect is reachable from client-side OAuth misconfiguration
    // (invalid_client / unauthorized_client), so the underlying grant may
    // still be perfectly live — which is exactly why leaving it in place is
    // dangerous rather than harmless.
    seedSubscription({ status: "needs_reconnect" })
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    )
    expect(leaks(creds)).toBe(false)
    expect(creds.CODEX_CREDENTIALS).toBeUndefined()
  })

  it("strips the stored blob for a non-codex agent", async () => {
    seedSubscription()
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "gemini", model: "gemini-3-flash" } as never)
    )
    expect(leaks(creds)).toBe(false)
  })

  it("strips the stored blob for a custom codex endpoint", async () => {
    seedSubscription()
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "codex", model: "endpoint:c1" } as never)
    )
    expect(leaks(creds)).toBe(false)
  })

  it("injects an auth.json carrying the placeholder — never the real token — on the happy path", async () => {
    seedSubscription()
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    )
    expect(leaks(creds)).toBe(false)
    expect(creds.CODEX_CREDENTIALS).toContain(CODEX_PLACEHOLDER_REFRESH_TOKEN)
    expect(JSON.parse(creds.CODEX_CREDENTIALS!).tokens.access_token).toBe("at.stored")
  })

  it("strips the stored blob when a due refresh fails transiently against an expired token", async () => {
    seedSubscription({ expires_at: nowSec() - 10, earliest_refresh_at: nowSec() - 100 })
    refreshCodexTokens.mockRejectedValue(new Error("HTTP 503"))
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    )
    expect(leaks(creds)).toBe(false)
    expect(creds.CODEX_CREDENTIALS).toBeUndefined()
  })

  it("leaves credentials untouched for a user with no subscription at all", async () => {
    vi.mocked(getUserCredentials).mockResolvedValue({ OPENAI_API_KEY: "sk-1" })
    const creds = credentialsOf(
      await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    )
    expect(creds.CODEX_CREDENTIALS).toBeUndefined()
    expect(creds.OPENAI_API_KEY).toBe("sk-1")
  })
})
