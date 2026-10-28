/**
 * Unit tests for putting subscription access tokens behind Daytona secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const daytonaSecret = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@daytonaio/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@daytonaio/sdk")>()),
  Daytona: class {
    secret = daytonaSecret
  },
}))

import { SECRET_NAME_PATTERN } from "@background-agents/sandbox-secrets"
import { buildCodexAuthJson, type CodexStoredCredential } from "@/lib/codex-credentials"
import {
  CLAUDE_SHARED_SECRET_PREFIX,
  claudeSharedSecretSpec,
  codexAccessToken,
  codexSecretPrefix,
  codexSecretSpec,
  pruneClaudeSharedSecrets,
  pruneCodexSecrets,
  subscriptionSecretsEnabled,
} from "./subscription-secrets"

const codexCred: CodexStoredCredential = {
  refresh_token: "rt-real",
  access_token: "eyJ.access.token",
  id_token: "eyJ.id.token",
  account_id: "acct",
  expires_at: 2_000_000_000,
  earliest_refresh_at: 1_999_000_000,
  last_refresh: "2026-10-28T00:00:00.000Z",
  status: "connected",
}

const listed = (names: string[]) => ({
  items: names.map((name, i) => ({ id: `id_${name}`, name, createdAt: new Date(2026, 9, i + 1).toISOString() })),
  nextCursor: null,
})

beforeEach(() => {
  process.env.DAYTONA_API_KEY = "dtn-test"
  process.env.DAYTONA_USER_KEY_SECRETS = "CODEX_CREDENTIALS,CLAUDE_SHARED"
  daytonaSecret.list.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  daytonaSecret.delete.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.DAYTONA_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

describe("subscriptionSecretsEnabled", () => {
  it("is on when listed, all or unset, off when left out", () => {
    expect(subscriptionSecretsEnabled("CODEX_CREDENTIALS")).toBe(true)
    expect(subscriptionSecretsEnabled("CLAUDE_SHARED")).toBe(true)
    for (const value of ["all", undefined]) {
      if (value === undefined) delete process.env.DAYTONA_USER_KEY_SECRETS
      else process.env.DAYTONA_USER_KEY_SECRETS = value
      expect(subscriptionSecretsEnabled("CODEX_CREDENTIALS")).toBe(true)
      expect(subscriptionSecretsEnabled("CLAUDE_SHARED")).toBe(true)
    }
    process.env.DAYTONA_USER_KEY_SECRETS = "CODEX_CREDENTIALS"
    expect(subscriptionSecretsEnabled("CLAUDE_SHARED")).toBe(false)
  })
})

describe("codexAccessToken", () => {
  it("reads the access token from a rendered auth.json", () => {
    expect(codexAccessToken(buildCodexAuthJson(codexCred, Date.now()))).toBe("eyJ.access.token")
  })

  it("is undefined for anything else", () => {
    expect(codexAccessToken("not json")).toBeUndefined()
    expect(codexAccessToken(JSON.stringify({ OPENAI_API_KEY: "sk" }))).toBeUndefined()
  })
})

describe("secret specs", () => {
  it("name each token's secret after a hash of it, on its provider's hosts", () => {
    const codex = codexSecretSpec("user-1", "eyJ.access.token")
    expect(codex.name).toMatch(SECRET_NAME_PATTERN)
    expect(codex.name.startsWith(codexSecretPrefix("user-1"))).toBe(true)
    expect(codex.name).not.toContain("access")
    expect(codex.hosts).toEqual(["chatgpt.com", "*.chatgpt.com"])
    expect(codexSecretSpec("user-1", "eyJ.refreshed").name).not.toBe(codex.name)

    const claude = claudeSharedSecretSpec("sk-ant-oat01-x")
    expect(claude.name.startsWith(CLAUDE_SHARED_SECRET_PREFIX)).toBe(true)
    expect(claude.hosts).toEqual(["api.anthropic.com"])
    expect(claude.value()).toBe("sk-ant-oat01-x")
  })
})

describe("pruning", () => {
  it("keeps the two newest Codex token secrets after a refresh", async () => {
    const prefix = codexSecretPrefix("user-1")
    daytonaSecret.list.mockResolvedValueOnce(listed([`${prefix}a`, `${prefix}b`, `${prefix}c`]))
    await pruneCodexSecrets("user-1")
    expect(daytonaSecret.delete.mock.calls).toEqual([[`id_${prefix}a`]])
  })

  it("deletes every Codex token secret on disconnect, even with the feature off", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = ""
    const prefix = codexSecretPrefix("user-1")
    daytonaSecret.list.mockResolvedValueOnce(listed([`${prefix}a`, `${prefix}b`]))
    await pruneCodexSecrets("user-1", { all: true })
    expect(daytonaSecret.delete).toHaveBeenCalledTimes(2)
  })

  it("keeps the two newest shared Claude secrets, and does nothing while off", async () => {
    const p = CLAUDE_SHARED_SECRET_PREFIX
    daytonaSecret.list.mockResolvedValueOnce(listed([`${p}a`, `${p}b`, `${p}c`]))
    await pruneClaudeSharedSecrets()
    expect(daytonaSecret.delete.mock.calls).toEqual([[`id_${p}a`]])

    process.env.DAYTONA_USER_KEY_SECRETS = "CODEX_CREDENTIALS"
    daytonaSecret.list.mockClear()
    await pruneClaudeSharedSecrets()
    expect(daytonaSecret.list).not.toHaveBeenCalled()
  })

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    daytonaSecret.list.mockRejectedValue(new Error("403"))
    await expect(pruneCodexSecrets("user-1")).resolves.toBeUndefined()
    await expect(pruneClaudeSharedSecrets()).resolves.toBeUndefined()
  })
})
