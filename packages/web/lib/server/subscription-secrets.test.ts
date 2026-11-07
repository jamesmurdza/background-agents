/**
 * Unit tests for putting subscription access tokens behind Daytona secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const daytonaSecret = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@daytonaio/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@daytonaio/sdk")>()),
  Daytona: class {
    secret = daytonaSecret
  },
}))

import { secretName } from "@background-agents/sandbox-secrets"
import { buildCodexAuthJson, type CodexStoredCredential } from "@/lib/codex-credentials"
import {
  CLAUDE_SECRET_HOSTS,
  CODEX_SECRET_HOSTS,
  codexAccessToken,
  ensureClaudeSharedSecret,
  ensureCodexSecret,
  pruneClaudeSharedSecrets,
  pruneCodexSecrets,
  subscriptionSecretsEnabled,
} from "./subscription-secrets"
import { Daytona } from "@daytonaio/sdk"

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

beforeEach(() => {
  process.env.DAYTONA_USER_KEY_SECRETS = "CODEX_CREDENTIALS,CLAUDE_SHARED"
  daytonaSecret.list.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  daytonaSecret.create.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: `ph_${name}` }))
  daytonaSecret.update.mockReset().mockResolvedValue({})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
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

describe("ensureCodexSecret / ensureClaudeSharedSecret", () => {
  it("names each token's secret after a hash of it, on its provider's hosts", async () => {
    const daytona = new Daytona({ apiKey: "dtn-test" })
    await ensureCodexSecret(daytona, "eyJ.access.token")
    expect(daytonaSecret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: secretName("eyJ.access.token", CODEX_SECRET_HOSTS), hosts: CODEX_SECRET_HOSTS })
    )
    expect(daytonaSecret.create.mock.calls[0][0].name).not.toContain("access")

    await ensureClaudeSharedSecret(daytona, "sk-ant-oat01-x")
    expect(daytonaSecret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: secretName("sk-ant-oat01-x", CLAUDE_SECRET_HOSTS), hosts: CLAUDE_SECRET_HOSTS })
    )
  })
})

describe("pruning is now a no-op", () => {
  it("never throws, and never touches Daytona: an old token's secret just ages out of the cleanup sweep", async () => {
    await expect(pruneCodexSecrets("user-1")).resolves.toBeUndefined()
    await expect(pruneCodexSecrets("user-1", { all: true })).resolves.toBeUndefined()
    await expect(pruneClaudeSharedSecrets()).resolves.toBeUndefined()
    expect(daytonaSecret.list).not.toHaveBeenCalled()
    expect(daytonaSecret.delete).not.toHaveBeenCalled()
  })
})
