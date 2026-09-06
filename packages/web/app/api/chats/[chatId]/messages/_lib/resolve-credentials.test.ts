import { describe, it, expect, vi, beforeEach } from "vitest"

const { resolveCodexAuthJson, codexFlagState } = vi.hoisted(() => ({
  resolveCodexAuthJson: vi.fn(),
  // The real CODEX_SUBSCRIPTION_ENABLED reads process.env at module-eval
  // time and is off by default (unset in this repo and in CI). Rather than
  // freezing the mock at one value, this exposes a mutable flag so tests can
  // genuinely exercise both the on and off branches of resolve-credentials.ts's
  // `CODEX_SUBSCRIPTION_ENABLED && ...` guard — the getter below makes the
  // mocked export a live binding that reflects whatever this object holds at
  // call time, not just at import time.
  codexFlagState: { enabled: true },
}))
vi.mock("@/lib/server/codex-credentials", () => ({ resolveCodexAuthJson }))
vi.mock("@/lib/codex-credentials", () => ({
  get CODEX_SUBSCRIPTION_ENABLED() {
    return codexFlagState.enabled
  },
}))
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

beforeEach(() => {
  resolveCodexAuthJson.mockReset()
  vi.mocked(getUserCredentials).mockResolvedValue({})
  codexFlagState.enabled = true
})

describe("resolveSendCredentials for codex", () => {
  it("injects a resolved auth.json for a codex run", async () => {
    resolveCodexAuthJson.mockResolvedValue('{"tokens":{"access_token":"at"}}')
    const out = await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    expect("credentials" in out && out.credentials.CODEX_CREDENTIALS).toBe(
      '{"tokens":{"access_token":"at"}}'
    )
  })

  it("leaves credentials untouched when the user has no subscription", async () => {
    resolveCodexAuthJson.mockResolvedValue(null)
    vi.mocked(getUserCredentials).mockResolvedValue({ OPENAI_API_KEY: "sk-1" })
    const out = await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    expect("credentials" in out && out.credentials.CODEX_CREDENTIALS).toBeUndefined()
    expect("credentials" in out && out.credentials.OPENAI_API_KEY).toBe("sk-1")
  })

  it("does not resolve a subscription for a non-codex agent", async () => {
    await resolveSendCredentials("u1", { agent: "gemini", model: "gemini-3-flash" } as never)
    expect(resolveCodexAuthJson).not.toHaveBeenCalled()
  })

  it("does not resolve a subscription for a custom codex endpoint", async () => {
    await resolveSendCredentials("u1", { agent: "codex", model: "endpoint:c1" } as never)
    expect(resolveCodexAuthJson).not.toHaveBeenCalled()
  })

  it("leaves behavior byte-for-byte unchanged when the flag is off (the default), even with a stored subscription available", async () => {
    codexFlagState.enabled = false
    resolveCodexAuthJson.mockResolvedValue('{"tokens":{"access_token":"at"}}')
    vi.mocked(getUserCredentials).mockResolvedValue({ OPENAI_API_KEY: "sk-1" })
    const out = await resolveSendCredentials("u1", { agent: "codex", model: "gpt-5.1-codex" } as never)
    expect(resolveCodexAuthJson).not.toHaveBeenCalled()
    expect("credentials" in out && out.credentials.CODEX_CREDENTIALS).toBeUndefined()
    expect("credentials" in out && out.credentials.OPENAI_API_KEY).toBe("sk-1")
  })
})
