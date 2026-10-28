/**
 * Unit tests for putting users' own provider keys behind Daytona secrets.
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
import {
  syncUserKeySecret,
  userKeySecretName,
  userKeySecretPrefix,
  userKeySecretsEnabled,
} from "./user-key-secrets"

let counter = 0

beforeEach(() => {
  process.env.DAYTONA_API_KEY = "dtn-test"
  process.env.DAYTONA_USER_KEY_SECRETS = "all"
  daytonaSecret.list.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  daytonaSecret.create.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: "p" }))
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

describe("userKeySecretName", () => {
  it("is a valid name, scoped to the user and credential, that hides both", () => {
    const name = userKeySecretName("user-1", "ANTHROPIC_API_KEY", "sk-ant-secret")
    expect(name).toMatch(SECRET_NAME_PATTERN)
    expect(name.startsWith(userKeySecretPrefix("user-1", "ANTHROPIC_API_KEY"))).toBe(true)
    expect(name.startsWith(userKeySecretPrefix("user-1"))).toBe(true)
    expect(name).not.toContain("user-1")
    expect(name).not.toContain("secret")
  })

  it("changes with the key, the user and the credential", () => {
    const name = userKeySecretName("user-1", "OPENAI_API_KEY", "k")
    expect(userKeySecretName("user-1", "OPENAI_API_KEY", "k")).toBe(name)
    expect(userKeySecretName("user-1", "OPENAI_API_KEY", "k2")).not.toBe(name)
    expect(userKeySecretName("user-2", "OPENAI_API_KEY", "k")).not.toBe(name)
    expect(userKeySecretName("user-1", "KIMI_API_KEY", "k")).not.toBe(name)
  })

  it("never collides with a shared pool's secret names", () => {
    expect(userKeySecretName("user-1", "OPENCODE_API_KEY", "k").startsWith("opencode_")).toBe(false)
  })
})

describe("syncUserKeySecret", () => {
  const user = () => `user-sync-${counter++}`

  it("creates the saved key's secret and deletes the user's others for it", async () => {
    const userId = user()
    const prefix = userKeySecretPrefix(userId, "OPENAI_API_KEY")
    const current = userKeySecretName(userId, "OPENAI_API_KEY", "sk-new")
    daytonaSecret.list
      .mockResolvedValueOnce({ items: [] }) // ensure: not there yet
      .mockResolvedValueOnce({
        items: [
          { id: "1", name: `${prefix}old` },
          { id: "2", name: current },
        ],
        nextCursor: null,
      })
    await syncUserKeySecret(userId, "OPENAI_API_KEY", "sk-new")
    expect(daytonaSecret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: current, value: "sk-new", hosts: ["api.openai.com"] })
    )
    expect(daytonaSecret.delete.mock.calls).toEqual([["1"]])
  })

  it("deletes every secret for a removed key", async () => {
    const userId = user()
    const prefix = userKeySecretPrefix(userId, "KIMI_API_KEY")
    daytonaSecret.list.mockResolvedValueOnce({ items: [{ id: "9", name: `${prefix}abc` }], nextCursor: null })
    await syncUserKeySecret(userId, "KIMI_API_KEY", undefined)
    expect(daytonaSecret.create).not.toHaveBeenCalled()
    expect(daytonaSecret.delete.mock.calls).toEqual([["9"]])
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
