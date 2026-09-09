/**
 * PATCH /api/user/settings previously did a plain findUnique + update on
 * User.credentials with no lock and no transaction. A concurrent Codex
 * refresh (which DOES take a transaction-scoped row lock — see
 * lib/server/codex-credentials.ts) could land its rotated token in between
 * this route's read and write; the route would then commit its own stale
 * in-memory copy of `credentials` on top of it, silently reverting a
 * just-rotated refresh token back to one OpenAI has already invalidated.
 *
 * This suite proves the fix: the route now performs its read-modify-write
 * inside the SAME row lock a Codex refresh takes, so the two can never
 * interleave that way.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

// Lock-aware stand-in for User.credentials + the row lock, matching the one
// in lib/server/codex-credentials.test.ts: only a transaction that actually
// issues the row-lock `$queryRaw` serializes against another transaction for
// the same userId. This is what lets the race test below mean anything.
const testState = vi.hoisted(() => ({
  store: new Map<string, Record<string, string>>(),
  locks: new Map<string, Promise<unknown>>(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown, _options?: unknown) => {
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
            settings: null,
            customEndpoints: null,
            credentials: testState.store.get(where.id) ?? null,
          }),
          update: async ({
            where,
            data,
          }: {
            where: { id: string }
            data: { credentials?: Record<string, string> }
          }) => {
            if (data.credentials) testState.store.set(where.id, data.credentials)
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

vi.mock("@/lib/server/credential-flags", () => ({
  getEffectiveCredentialFlags: vi.fn().mockResolvedValue({
    flags: {},
    isPro: false,
    plan: "free",
    creditBalanceUsd: null,
  }),
}))

vi.mock("@/lib/db/provider-pricing", () => ({
  getProviderMultipliers: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: "u1" }),
  isAuthError: (r: unknown) => r instanceof Response,
  badRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
  internalError: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 }),
}))

import { PATCH } from "./route"
import { storeCodexCredential, readCodexCredential } from "@/lib/server/codex-credentials"
import type { CodexStoredCredential } from "@/lib/codex-credentials"

function fakeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function cred(overrides: Partial<CodexStoredCredential> = {}): CodexStoredCredential {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    refresh_token: "rt.a",
    access_token: "at.a",
    id_token: "id.a",
    account_id: "acct-1",
    expires_at: nowSec + 864000,
    earliest_refresh_at: nowSec + 777600,
    last_refresh: new Date().toISOString(),
    status: "connected",
    ...overrides,
  }
}

beforeEach(() => {
  testState.store.clear()
  testState.locks.clear()
})

describe("PATCH /api/user/settings", () => {
  it("does not drop a concurrently-written CODEX_CREDENTIALS value", async () => {
    await storeCodexCredential("u1", cred({ refresh_token: "rt.original" }))

    const rotated = cred({ refresh_token: "rt.rotated" })

    // A settings-only PATCH (no `credentials` field at all) racing a Codex
    // refresh landing its rotation. Whichever runs second must see the
    // other's write when it re-reads inside the lock.
    const [patchRes] = await Promise.all([
      PATCH(fakeRequest({ settings: { theme: "dark" } })),
      storeCodexCredential("u1", rotated),
    ])

    expect(patchRes.status).toBe(200)
    const stored = await readCodexCredential("u1")
    expect(stored?.refresh_token).toBe("rt.rotated")
  })
})
