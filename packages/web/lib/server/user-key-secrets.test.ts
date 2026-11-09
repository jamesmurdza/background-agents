/**
 * Unit tests for putting users' own provider keys behind Daytona secrets.
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
import { syncUserKeySecret, userKeySecretsEnabled } from "./user-key-secrets"

let counter = 0

beforeEach(() => {
  process.env.DAYTONA_API_KEY = "dtn-test"
  process.env.DAYTONA_USER_KEY_SECRETS = "all"
  daytonaSecret.list.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  daytonaSecret.create.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: "p" }))
  daytonaSecret.update.mockReset().mockResolvedValue({})
  daytonaSecret.delete.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.DAYTONA_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

describe("userKeySecretsEnabled", () => {
  it("is on when DAYTONA_USER_KEY_SECRETS is unset, says all or names the credential", () => {
    delete process.env.DAYTONA_USER_KEY_SECRETS
    expect(userKeySecretsEnabled("ANTHROPIC_API_KEY")).toBe(true)
    expect(userKeySecretsEnabled("COPILOT_GITHUB_TOKEN")).toBe(false) // no provider entry
    process.env.DAYTONA_USER_KEY_SECRETS = "none"
    expect(userKeySecretsEnabled("ANTHROPIC_API_KEY")).toBe(false)
    process.env.DAYTONA_USER_KEY_SECRETS = "KIMI_API_KEY, OPENAI_API_KEY"
    expect(userKeySecretsEnabled("OPENAI_API_KEY")).toBe(true)
    expect(userKeySecretsEnabled("ANTHROPIC_API_KEY")).toBe(false)
    process.env.DAYTONA_USER_KEY_SECRETS = "all"
    expect(userKeySecretsEnabled("ANTHROPIC_API_KEY")).toBe(true)
    expect(userKeySecretsEnabled("COMMAND_CODE_API_KEY")).toBe(true)
  })

  it("never covers credentials without a verified provider", () => {
    expect(userKeySecretsEnabled("COPILOT_GITHUB_TOKEN")).toBe(false)
    expect(userKeySecretsEnabled("CLAUDE_CODE_CREDENTIALS")).toBe(false)
    expect(userKeySecretsEnabled("CODEX_CREDENTIALS")).toBe(false)
    expect(userKeySecretsEnabled("GOOGLE_API_KEY")).toBe(false)
  })
})

describe("syncUserKeySecret", () => {
  const user = () => `user-sync-${counter++}`

  it("creates the saved key's secret, named after the value and its provider's hosts", async () => {
    const userId = user()
    await syncUserKeySecret(userId, "OPENAI_API_KEY", "sk-new")
    const name = secretName("sk-new", ["api.openai.com"])
    expect(daytonaSecret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name, value: "sk-new", hosts: ["api.openai.com"] })
    )
  })

  it("does nothing for a removed key: nothing to create", async () => {
    await syncUserKeySecret(user(), "KIMI_API_KEY", undefined)
    expect(daytonaSecret.create).not.toHaveBeenCalled()
  })

  it("does nothing for a credential that isn't enabled", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "KIMI_API_KEY"
    await syncUserKeySecret(user(), "OPENAI_API_KEY", "sk")
    await syncUserKeySecret(user(), "COPILOT_GITHUB_TOKEN", "ghp")
    expect(daytonaSecret.list).not.toHaveBeenCalled()
  })

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    daytonaSecret.list.mockRejectedValue(new Error("403"))
    await expect(syncUserKeySecret(user(), "OPENAI_API_KEY", "sk")).resolves.toBeUndefined()
  })
})
