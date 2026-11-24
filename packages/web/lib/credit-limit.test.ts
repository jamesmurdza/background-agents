import { describe, expect, it } from "vitest"
import { exhaustedCreditProvider } from "./credit-limit"

describe("exhaustedCreditProvider", () => {
  const base = { agent: "claude-code" as const, model: "sonnet", credentialFlags: { CLAUDE_SHARED_POOL_AVAILABLE: true }, balanceUsd: 0 }

  it.each([0, -0.05])("blocks shared paid models at a balance of %s", (balanceUsd) => {
    expect(exhaustedCreditProvider({ ...base, balanceUsd })).toBe("claude")
  })

  it.each([null, undefined, 0.05, 1])("allows a loaded positive balance or waits for an unknown balance (%s)", (balanceUsd) => {
    expect(exhaustedCreditProvider({ ...base, balanceUsd })).toBeNull()
  })

  it("honors the server exhaustion flag even before the balance refreshes", () => {
    expect(exhaustedCreditProvider({ ...base, balanceUsd: 1, credentialFlags: { ...base.credentialFlags, SHARED_BALANCE_EXHAUSTED: true } })).toBe("claude")
  })

  it.each([
    { agent: "opencode" as const, model: "opencode-go/glm-5.3", credentialFlags: { OPENCODE_API_KEY_SHARED: true }, provider: "opencode" },
    { agent: "gemini" as const, model: "gemini-2.5-flash", credentialFlags: { GEMINI_API_KEY_SHARED: true }, provider: "gemini" },
  ])("returns the correct provider for $agent", ({ provider, ...selection }) => {
    expect(exhaustedCreditProvider({ ...base, ...selection })).toBe(provider)
  })

  it.each([
    { agent: "opencode" as const, model: "opencode/big-pickle", credentialFlags: { OPENCODE_API_KEY_SHARED: true } },
    { model: "endpoint:custom" },
    { credentialFlags: { CLAUDE_SHARED_POOL_AVAILABLE: true, ANTHROPIC_API_KEY: true } },
    { credentialFlags: { CLAUDE_SHARED_POOL_AVAILABLE: true, CLAUDE_CODE_CREDENTIALS: true } },
    { agent: "opencode" as const, model: "opencode-go/glm-5.3", credentialFlags: { OPENCODE_API_KEY_SHARED: true, OPENCODE_API_KEY_USER: true } },
    { agent: "gemini" as const, model: "gemini-2.5-flash", credentialFlags: { GEMINI_API_KEY_SHARED: true, GEMINI_API_KEY_USER: true } },
    { providerMultipliers: { claude: 0 } },
  ])("does not block free or personal credential routes (%j)", (selection) => {
    expect(exhaustedCreditProvider({ ...base, ...selection })).toBeNull()
  })

  it("leaves missing credentials to the API-key setup flow", () => {
    expect(exhaustedCreditProvider({ ...base, credentialFlags: {} })).toBeNull()
  })
})
