import { describe, expect, it } from "vitest"
import { parseThinking, thinkingCapability } from "./thinking"

describe("thinking API contract", () => {
  it("maps web agent IDs to the SDK without confusing plan mode with effort", () => {
    expect(parseThinking("claude-code", "sonnet", "high")).toBe("high")
    expect(thinkingCapability("eliza", "eliza-classic-1.0").levels).toEqual([])
  })
  it("rejects malformed input and provider changes instead of silently downgrading", () => {
    for (const value of [[], {}, false, 100, "high; echo injected"]) {
      expect(() => parseThinking("codex", "gpt-6.1-sol", value)).toThrow("Choose Default")
    }
    expect(() => parseThinking("codex", "endpoint:custom", "high")).toThrow()
    expect(parseThinking("codex", "endpoint:custom", undefined)).toBe("default")
  })
})
