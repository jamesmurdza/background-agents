import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeOAuthCredentials } from "@background-agents/claude-credentials"

const { refreshClaudeOAuth, pruneClaudeOwnSecrets } = vi.hoisted(() => ({
  refreshClaudeOAuth: vi.fn(),
  pruneClaudeOwnSecrets: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./subscription-secrets", () => ({ pruneClaudeOwnSecrets, pruneCodexSecrets: vi.fn() }))
vi.mock("./claude-oauth", async () => {
  const actual = await vi.importActual<typeof import("./claude-oauth")>("./claude-oauth")
  return { ...actual, refreshClaudeOAuth }
})

// User.credentials in memory, with withUserLock's row lock serializing per
// user as SELECT ... FOR UPDATE does (see codex-credentials.test).
const state = vi.hoisted(() => ({
  store: new Map<string, Record<string, string>>(),
  locks: new Map<string, Promise<unknown>>(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => {
      const released: { fn: (() => void) | null } = { fn: null }
      const tx = {
        $queryRaw: async (_strings: TemplateStringsArray, ...vals: string[]) => {
          const uid = vals[0]
          const prev = state.locks.get(uid) ?? Promise.resolve()
          let resolveMine: () => void = () => {}
          const mine = new Promise<void>((resolve) => { resolveMine = resolve })
          state.locks.set(uid, prev.then(() => mine))
          await prev
          released.fn = resolveMine
          return [{ id: uid }]
        },
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => ({ credentials: state.store.get(where.id) ?? null }),
          update: async ({ where, data }: { where: { id: string }; data: { credentials: Record<string, string> } }) => {
            state.store.set(where.id, data.credentials)
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

import { decrypt, encrypt } from "@/lib/db/encryption"
import { ClaudeRefreshRejectedError } from "./claude-oauth"
import {
  OwnClaudeCredentialsExpiredError,
  OwnClaudeCredentialsUnavailableError,
  REFRESH_MARGIN_MS,
  getUserClaudeAccessToken,
} from "./user-claude-credentials"

const USER = "u1"
const creds = (expiresIn: number, accessToken = "at.stored", refreshToken = "rt.stored"): ClaudeOAuthCredentials => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt: Date.now() + expiresIn, scopes: ["user:inference"] },
} as ClaudeOAuthCredentials)
const store = (c: ClaudeOAuthCredentials) => state.store.set(USER, { CLAUDE_CODE_CREDENTIALS: encrypt(JSON.stringify(c)) })
const stored = () => JSON.parse(decrypt(state.store.get(USER)!.CLAUDE_CODE_CREDENTIALS)) as ClaudeOAuthCredentials

beforeEach(() => {
  state.store.clear()
  state.locks.clear()
  refreshClaudeOAuth.mockReset()
  pruneClaudeOwnSecrets.mockClear()
})

describe("getUserClaudeAccessToken", () => {
  it("returns a token that isn't expiring without refreshing", async () => {
    store(creds(REFRESH_MARGIN_MS * 2))
    await expect(getUserClaudeAccessToken(USER)).resolves.toBe("at.stored")
    expect(refreshClaudeOAuth).not.toHaveBeenCalled()
  })

  it("refreshes an expiring token, saving the rotated refresh token before handing it out", async () => {
    store(creds(60_000))
    refreshClaudeOAuth.mockResolvedValue(creds(3_600_000, "at.new", "rt.new"))
    await expect(getUserClaudeAccessToken(USER)).resolves.toBe("at.new")
    expect(stored().claudeAiOauth).toMatchObject({ accessToken: "at.new", refreshToken: "rt.new" })
    expect(pruneClaudeOwnSecrets).toHaveBeenCalledWith(USER)
  })

  it("spends the refresh token once when runs race for it", async () => {
    store(creds(60_000))
    refreshClaudeOAuth.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return creds(3_600_000, "at.new", "rt.new")
    })
    const tokens = await Promise.all([1, 2, 3].map(() => getUserClaudeAccessToken(USER)))
    expect(tokens).toEqual(["at.new", "at.new", "at.new"])
    expect(refreshClaudeOAuth).toHaveBeenCalledTimes(1)
  })

  it("asks for a new login when there's none, or the refresh token is dead and the token expired", async () => {
    await expect(getUserClaudeAccessToken(USER)).rejects.toBeInstanceOf(OwnClaudeCredentialsExpiredError)
    store(creds(-1000))
    refreshClaudeOAuth.mockRejectedValue(new ClaudeRefreshRejectedError(400))
    await expect(getUserClaudeAccessToken(USER)).rejects.toBeInstanceOf(OwnClaudeCredentialsExpiredError)
  })

  it("keeps using a still-valid token when a refresh fails", async () => {
    store(creds(60_000))
    refreshClaudeOAuth.mockRejectedValue(new ClaudeRefreshRejectedError(400))
    await expect(getUserClaudeAccessToken(USER)).resolves.toBe("at.stored")
    refreshClaudeOAuth.mockRejectedValue(new Error("Claude token refresh failed (HTTP 500)"))
    await expect(getUserClaudeAccessToken(USER)).resolves.toBe("at.stored")
    expect(stored().claudeAiOauth.refreshToken).toBe("rt.stored")
  })

  it("reports a transient failure on an expired token as retryable", async () => {
    store(creds(-1000))
    refreshClaudeOAuth.mockRejectedValue(new Error("Claude token refresh failed (HTTP 500)"))
    await expect(getUserClaudeAccessToken(USER)).rejects.toBeInstanceOf(OwnClaudeCredentialsUnavailableError)
  })
})
