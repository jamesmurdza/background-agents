import { describe, it, expect } from "vitest"
import {
  createProvider,
  getProviderNames,
  isValidProvider,
} from "../src/factory.js"
import { ClaudeProvider } from "../src/providers/claude.js"
import { CodexProvider } from "../src/providers/codex.js"
import { OpenCodeProvider } from "../src/providers/opencode.js"
import { GeminiProvider } from "../src/providers/gemini.js"

describe("createProvider", () => {
  it("should create ClaudeProvider for 'claude'", () => {
    const provider = createProvider("claude")
    expect(provider).toBeInstanceOf(ClaudeProvider)
    expect(provider.name).toBe("claude")
  })

  it("should create CodexProvider for 'codex'", () => {
    const provider = createProvider("codex")
    expect(provider).toBeInstanceOf(CodexProvider)
    expect(provider.name).toBe("codex")
  })

  it("should create OpenCodeProvider for 'opencode'", () => {
    const provider = createProvider("opencode")
    expect(provider).toBeInstanceOf(OpenCodeProvider)
    expect(provider.name).toBe("opencode")
  })

  it("should create GeminiProvider for 'gemini'", () => {
    const provider = createProvider("gemini")
    expect(provider).toBeInstanceOf(GeminiProvider)
    expect(provider.name).toBe("gemini")
  })

  it("should throw for unknown provider", () => {
    expect(() => createProvider("unknown")).toThrow("Unknown provider: unknown")
  })

  it("should include valid providers in error message", () => {
    expect(() => createProvider("invalid")).toThrow(/claude, codex, opencode, gemini/)
  })
})

describe("getProviderNames", () => {
  it("should return all provider names", () => {
    const names = getProviderNames()
    expect(names).toContain("claude")
    expect(names).toContain("codex")
    expect(names).toContain("opencode")
    expect(names).toContain("gemini")
    expect(names).toHaveLength(4)
  })
})

describe("isValidProvider", () => {
  it("should return true for valid providers", () => {
    expect(isValidProvider("claude")).toBe(true)
    expect(isValidProvider("codex")).toBe(true)
    expect(isValidProvider("opencode")).toBe(true)
    expect(isValidProvider("gemini")).toBe(true)
  })

  it("should return false for invalid providers", () => {
    expect(isValidProvider("unknown")).toBe(false)
    expect(isValidProvider("")).toBe(false)
    expect(isValidProvider("Claude")).toBe(false) // case-sensitive
  })
})
