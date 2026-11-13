/**
 * Unit tests for first-party Claude pricing.
 */
import { describe, it, expect } from "vitest"

import { normalizeClaudeModel, priceClaudeTurn } from "./claude-pricing"

const NO_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
}

describe("normalizeClaudeModel", () => {
  it("normalizes current ids, with and without a release date", () => {
    expect(normalizeClaudeModel("claude-opus-4-5")).toBe("opus-4.5")
    expect(normalizeClaudeModel("claude-opus-4-5-20251101")).toBe("opus-4.5")
    expect(normalizeClaudeModel("claude-sonnet-4-6")).toBe("sonnet-4.6")
    expect(normalizeClaudeModel("claude-haiku-4-5-20251001")).toBe("haiku-4.5")
  })

  it("does not read a release date as the minor version", () => {
    expect(normalizeClaudeModel("claude-opus-5")).toBe("opus-5")
    expect(normalizeClaudeModel("claude-opus-5-20260101")).toBe("opus-5")
    expect(normalizeClaudeModel("claude-sonnet-5-20260315")).toBe("sonnet-5")
  })

  it("accepts dotted versions, vendor prefixes and suffixes", () => {
    expect(normalizeClaudeModel("claude-opus-4.8")).toBe("opus-4.8")
    expect(normalizeClaudeModel("anthropic/claude-sonnet-5")).toBe("sonnet-5")
    expect(normalizeClaudeModel("us.anthropic.claude-opus-4-5-20251101-v1:0")).toBe(
      "opus-4.5"
    )
    expect(normalizeClaudeModel("claude-opus-4-6-thinking")).toBe("opus-4.6")
    expect(normalizeClaudeModel("CLAUDE-OPUS-5")).toBe("opus-5")
  })

  it("handles the legacy version-first ordering", () => {
    expect(normalizeClaudeModel("claude-3-5-haiku-20241022")).toBe("haiku-3.5")
  })

  it("returns null for non-Claude and empty ids", () => {
    expect(normalizeClaudeModel("gpt-5.3")).toBeNull()
    expect(normalizeClaudeModel("glm-5.2")).toBeNull()
    expect(normalizeClaudeModel(null)).toBeNull()
    expect(normalizeClaudeModel("")).toBeNull()
  })
})

describe("priceClaudeTurn", () => {
  it("prices base input and output at the published rates", () => {
    // Opus 5: $5/MTok in, $25/MTok out.
    const cost = priceClaudeTurn("claude-opus-5", {
      ...NO_TOKENS,
      inputTokens: 50_000,
      outputTokens: 15_000,
    })
    // 50k × $5/M = $0.25, 15k × $25/M = $0.375 — the worked example from
    // Anthropic's pricing page, minus its session-runtime line.
    expect(cost).toBeCloseTo(0.625, 10)
  })

  it("prices cache reads at 0.1x and cache writes at 1.25x base input", () => {
    const cost = priceClaudeTurn("claude-opus-5", {
      ...NO_TOKENS,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 8_000,
    })
    // 40k × $5 × 0.1/M = $0.02; 8k × $5 × 1.25/M = $0.05
    expect(cost).toBeCloseTo(0.07, 10)
  })

  it("bills reasoning tokens at the output rate", () => {
    const cost = priceClaudeTurn("claude-sonnet-5", {
      ...NO_TOKENS,
      reasoningTokens: 10_000,
    })
    // Sonnet 5 output is $10/MTok.
    expect(cost).toBeCloseTo(0.1, 10)
  })

  it("scales with the model tier", () => {
    const tokens = { ...NO_TOKENS, inputTokens: 1_000_000, outputTokens: 1_000_000 }
    expect(priceClaudeTurn("claude-haiku-4-5", tokens)).toBeCloseTo(6, 10)
    expect(priceClaudeTurn("claude-sonnet-5", tokens)).toBeCloseTo(12, 10)
    expect(priceClaudeTurn("claude-sonnet-4-6", tokens)).toBeCloseTo(18, 10)
    expect(priceClaudeTurn("claude-opus-5", tokens)).toBeCloseTo(30, 10)
    expect(priceClaudeTurn("claude-fable-5", tokens)).toBeCloseTo(60, 10)
    expect(priceClaudeTurn("claude-opus-4-1", tokens)).toBeCloseTo(90, 10)
  })

  it("returns 0 for a known model with no tokens", () => {
    expect(priceClaudeTurn("claude-opus-5", NO_TOKENS)).toBe(0)
  })

  it("returns null for models it has no rates for", () => {
    expect(priceClaudeTurn("gpt-5.3", { ...NO_TOKENS, outputTokens: 1000 })).toBeNull()
    // A Claude family/version that isn't in the table.
    expect(
      priceClaudeTurn("claude-3-7-sonnet-20250219", { ...NO_TOKENS, outputTokens: 1000 })
    ).toBeNull()
    expect(priceClaudeTurn(null, NO_TOKENS)).toBeNull()
  })

  it("prices the 5.x-generation models at their published rates", () => {
    const tokens = { ...NO_TOKENS, inputTokens: 1_000_000, outputTokens: 1_000_000 }
    // Opus 5.5: $4/MTok in, $20/MTok out.
    expect(priceClaudeTurn("claude-opus-5-5", tokens)).toBeCloseTo(24, 10)
    // Sonnet 5.5: $2/MTok in, $10/MTok out.
    expect(priceClaudeTurn("claude-sonnet-5-5", tokens)).toBeCloseTo(12, 10)
    // Fable 5.1 / Mythos 5.1: $10/MTok in, $50/MTok out.
    expect(priceClaudeTurn("claude-fable-5-1", tokens)).toBeCloseTo(60, 10)
    expect(priceClaudeTurn("claude-mythos-5-1", tokens)).toBeCloseTo(60, 10)
    // Fable 5.2 / Mythos 5.2: $8/MTok in, $40/MTok out.
    expect(priceClaudeTurn("claude-fable-5-2", tokens)).toBeCloseTo(48, 10)
    expect(priceClaudeTurn("claude-mythos-5-2", tokens)).toBeCloseTo(48, 10)
  })

  it("applies the lower cache-read multiplier on 5.x-generation models", () => {
    // Opus 5.5: cache reads are 0.05x input (not the standard 0.1x), input $4/MTok.
    const opus = priceClaudeTurn("claude-opus-5-5", { ...NO_TOKENS, cacheReadTokens: 1_000_000 })
    expect(opus).toBeCloseTo(4 * 0.05, 10)

    // Fable 5.2: cache reads are 0.025x input, input $8/MTok.
    const fable = priceClaudeTurn("claude-fable-5-2", {
      ...NO_TOKENS,
      cacheReadTokens: 1_000_000,
    })
    expect(fable).toBeCloseTo(8 * 0.025, 10)
  })

  it("switches Haiku 5.5 to the long-context tier once the prompt exceeds 100k tokens", () => {
    // At or under the threshold: base rate, $0.10/MTok in, $0.50/MTok out.
    const underThreshold = priceClaudeTurn("claude-haiku-5-5", {
      ...NO_TOKENS,
      inputTokens: 100_000,
      outputTokens: 1_000_000,
    })
    expect(underThreshold).toBeCloseTo(100_000 * 0.1 / 1_000_000 + 0.5, 10)

    // One token over: long-context rate, $0.50/MTok in, $2.50/MTok out, for the whole request.
    const overThreshold = priceClaudeTurn("claude-haiku-5-5", {
      ...NO_TOKENS,
      inputTokens: 100_001,
      outputTokens: 1_000_000,
    })
    expect(overThreshold).toBeCloseTo((100_001 * 0.5) / 1_000_000 + 2.5, 10)

    // Cache reads count toward the prompt-length threshold too.
    const cacheTipsOver = priceClaudeTurn("claude-haiku-5-5", {
      ...NO_TOKENS,
      inputTokens: 1,
      cacheReadTokens: 100_000,
    })
    expect(cacheTipsOver).toBeCloseTo((1 * 0.5) / 1_000_000 + (100_000 * 0.5 * 0.1) / 1_000_000, 10)
  })
})
