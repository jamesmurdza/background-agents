import { describe, it, expect } from "vitest"
import {
  parseCodexCredential,
  credentialFromTokenResponse,
  credentialFromCliAuthFile,
  needsRefresh,
  buildCodexAuthJson,
  CODEX_PLACEHOLDER_REFRESH_TOKEN,
  type CodexStoredCredential,
} from "./codex-credentials"

const NOW = 1_756_000_000_000 // ms
const nowSec = Math.floor(NOW / 1000)

function cred(overrides: Partial<CodexStoredCredential> = {}): CodexStoredCredential {
  return {
    refresh_token: "rt.real.SECRET",
    access_token: "at.real",
    id_token: "id.real",
    account_id: "acct-1",
    expires_at: nowSec + 864000,
    earliest_refresh_at: nowSec + 777600, // 9 days
    last_refresh: new Date(NOW).toISOString(),
    status: "connected",
    ...overrides,
  }
}

describe("parseCodexCredential", () => {
  it("round-trips a stored credential", () => {
    const c = cred()
    expect(parseCodexCredential(JSON.stringify(c))).toEqual(c)
  })

  it("returns null for absent, empty, or non-JSON values", () => {
    expect(parseCodexCredential(null)).toBeNull()
    expect(parseCodexCredential(undefined)).toBeNull()
    expect(parseCodexCredential("")).toBeNull()
    expect(parseCodexCredential("sk-a-pasted-api-key")).toBeNull()
  })

  it("returns null when a required field is missing", () => {
    const { access_token, ...partial } = cred()
    expect(parseCodexCredential(JSON.stringify(partial))).toBeNull()
  })
})

describe("credentialFromTokenResponse", () => {
  it("derives expires_at from expires_in and keeps the rotated refresh token", () => {
    const out = credentialFromTokenResponse(
      {
        access_token: "at.new",
        refresh_token: "rt.rotated",
        id_token: "id.new",
        expires_in: 864000,
        earliest_refresh_at: nowSec + 777600,
      },
      "acct-1",
      NOW
    )
    expect(out.expires_at).toBe(nowSec + 864000)
    expect(out.earliest_refresh_at).toBe(nowSec + 777600)
    expect(out.refresh_token).toBe("rt.rotated")
    expect(out.status).toBe("connected")
    expect(out.last_refresh).toBe(new Date(NOW).toISOString())
  })

  it("falls back to 24h before expiry when the response omits earliest_refresh_at", () => {
    const out = credentialFromTokenResponse(
      { access_token: "at", refresh_token: "rt", id_token: "id", expires_in: 864000 },
      "acct-1",
      NOW
    )
    expect(out.earliest_refresh_at).toBe(nowSec + 864000 - 86400)
  })
})

describe("credentialFromCliAuthFile", () => {
  it("extracts the four token fields the CLI writes", () => {
    const raw = JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: { id_token: "id", access_token: "at", refresh_token: "rt", account_id: "acct-9" },
      last_refresh: "2026-09-05T00:00:00.000Z",
    })
    expect(credentialFromCliAuthFile(raw)).toEqual({
      id_token: "id",
      access_token: "at",
      refresh_token: "rt",
      account_id: "acct-9",
    })
  })

  it("returns null when the CLI wrote an API-key login instead of a ChatGPT one", () => {
    const raw = JSON.stringify({ OPENAI_API_KEY: "sk-1", tokens: null, last_refresh: null })
    expect(credentialFromCliAuthFile(raw)).toBeNull()
  })
})

describe("needsRefresh", () => {
  it("is false inside the earliest_refresh_at window", () => {
    expect(needsRefresh(cred(), NOW)).toBe(false)
  })

  it("is true once earliest_refresh_at has passed", () => {
    expect(needsRefresh(cred({ earliest_refresh_at: nowSec - 1 }), NOW)).toBe(true)
  })

  it("is true when the access token is already expired, whatever the window says", () => {
    expect(
      needsRefresh(cred({ expires_at: nowSec - 1, earliest_refresh_at: nowSec + 999999 }), NOW)
    ).toBe(true)
  })
})

describe("buildCodexAuthJson", () => {
  it("writes real tokens, a placeholder refresh token, and a freshly stamped last_refresh", () => {
    const blob = JSON.parse(buildCodexAuthJson(cred(), NOW))
    expect(blob.tokens.access_token).toBe("at.real")
    expect(blob.tokens.id_token).toBe("id.real")
    expect(blob.tokens.account_id).toBe("acct-1")
    expect(blob.tokens.refresh_token).toBe(CODEX_PLACEHOLDER_REFRESH_TOKEN)
    expect(blob.last_refresh).toBe(new Date(NOW).toISOString())
    expect(blob.OPENAI_API_KEY).toBeNull()
  })

  it("never lets the real refresh token reach the sandbox", () => {
    const blob = buildCodexAuthJson(cred(), NOW)
    expect(blob).not.toContain("rt.real.SECRET")
  })
})
