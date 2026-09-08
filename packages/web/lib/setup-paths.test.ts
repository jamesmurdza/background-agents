import { describe, it, expect } from "vitest"
import { SETUP_SCRIPT_PATH, buildAssistedSetupPrompt } from "./setup-paths"

describe("buildAssistedSetupPrompt", () => {
  it("names the repo and environment", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).toContain("acme/widgets")
    expect(prompt).toContain('"Staging"')
  })

  it("says the real setup-script path, not a placeholder", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).toContain(SETUP_SCRIPT_PATH)
  })

  it("tells the agent to actually run the script, not just write it", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).toMatch(/run it/i)
    expect(prompt).toContain(`bash ${SETUP_SCRIPT_PATH}`)
  })

  it("forbids inlining secrets and tells the agent to ask by name instead", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).toMatch(/never put a secret/i)
    expect(prompt).toMatch(/stored unencrypted/i)
    expect(prompt).toMatch(/say which environment variable/i)
  })

  it("tells the agent the script must be idempotent", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).toMatch(/idempotent/i)
  })

  it("contains no em dashes", () => {
    const prompt = buildAssistedSetupPrompt("acme/widgets", "Staging")
    expect(prompt).not.toContain("—")
  })
})
