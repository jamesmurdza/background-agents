import { describe, it, expect, vi, beforeEach } from "vitest"

const { resolveCodexAuthJson } = vi.hoisted(() => ({ resolveCodexAuthJson: vi.fn() }))
vi.mock("@/lib/server/codex-credentials", () => ({ resolveCodexAuthJson }))
// The real CODEX_SUBSCRIPTION_ENABLED reads process.env at module-eval time
// and is off by default; this suite exercises the flag-on behavior, so pin
// it on here rather than depending on ambient env state.
vi.mock("@/lib/codex-credentials", () => ({ CODEX_SUBSCRIPTION_ENABLED: true }))
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
})
