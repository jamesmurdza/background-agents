import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * getSandboxClaudeCredentials() exists to fix a real production bug: a
 * sandbox's Claude CLI was handed the shared pool's REAL refresh token and
 * could self-refresh with it via a plain grant_type=refresh_token call. That
 * raced the refresh-claude-creds cron, which uses the exact same (rotating,
 * single-use) refresh token — whichever side used it second got rejected,
 * surfacing as "Failed to authenticate: OAuth session expired and could not
 * be refreshed" even though the shared pool's access token was still
 * perfectly valid. These tests assert on the SERIALIZED output (not just on
 * a flag), the same discipline the Codex credential tests use, because a
 * conditional/partial strip is exactly how a secret like this leaks.
 */

const testState = vi.hoisted(() => ({ value: null as string | null }))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ccAuthInfo: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "claude-credentials" && testState.value !== null
          ? { value: testState.value }
          : null,
      upsert: vi.fn(),
    },
  },
}))

import {
  getClaudeCredentials,
  getSandboxClaudeCredentials,
  CLAUDE_PLACEHOLDER_REFRESH_TOKEN,
} from "./claude-credentials"

const REAL_REFRESH_TOKEN = "rt.REAL-SHARED-POOL-SECRET-MUST-NOT-LEAK"

function seed(oauthOverrides: Record<string, unknown> = {}) {
  testState.value = JSON.stringify({
    claudeAiOauth: {
      accessToken: "sk-ant-oa-real",
      refreshToken: REAL_REFRESH_TOKEN,
      expiresAt: 1_800_000_000_000,
      scopes: ["user:inference"],
      ...oauthOverrides,
    },
  })
}

const leaks = (value: string) => value.includes(REAL_REFRESH_TOKEN)

beforeEach(() => {
  testState.value = null
})

describe("getSandboxClaudeCredentials", () => {
  it("never ships the real refresh token to a sandbox", async () => {
    seed()
    const out = await getSandboxClaudeCredentials()
    expect(leaks(out)).toBe(false)
    expect(JSON.parse(out).claudeAiOauth.refreshToken).toBe(
      CLAUDE_PLACEHOLDER_REFRESH_TOKEN
    )
  })

  it("preserves accessToken and expiresAt unchanged", async () => {
    seed()
    const out = await getSandboxClaudeCredentials()
    const parsed = JSON.parse(out)
    expect(parsed.claudeAiOauth.accessToken).toBe("sk-ant-oa-real")
    expect(parsed.claudeAiOauth.expiresAt).toBe(1_800_000_000_000)
  })

  it("preserves other claudeAiOauth fields (e.g. scopes) unchanged", async () => {
    seed({ scopes: ["user:inference", "user:profile"], subscriptionType: "max" })
    const out = await getSandboxClaudeCredentials()
    const parsed = JSON.parse(out)
    expect(parsed.claudeAiOauth.scopes).toEqual(["user:inference", "user:profile"])
    expect(parsed.claudeAiOauth.subscriptionType).toBe("max")
  })

  it("returns the value unchanged (not thrown) when the stored row is not valid JSON", async () => {
    testState.value = "not-json"
    const out = await getSandboxClaudeCredentials()
    expect(out).toBe("not-json")
  })

  it("returns the value unchanged when claudeAiOauth is missing", async () => {
    testState.value = JSON.stringify({ somethingElse: true })
    const out = await getSandboxClaudeCredentials()
    expect(JSON.parse(out)).toEqual({ somethingElse: true })
  })
})

describe("getClaudeCredentials (raw read, server-only callers)", () => {
  it("still carries the real refresh token — only the sandbox-facing helper strips it", async () => {
    seed()
    const raw = await getClaudeCredentials()
    expect(leaks(raw)).toBe(true)
  })
})
