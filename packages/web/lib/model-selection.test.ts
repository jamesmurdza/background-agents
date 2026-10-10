/**
 * Unit tests for resolveModelForAgent — the single resolver that decides which
 * model an agent should use, honoring the user's saved default preference only
 * when it's actually applicable.
 *
 * Pure function — no mocks needed. Fixtures use real agents/models so the test
 * stays honest about the credential rules.
 */
import { describe, it, expect } from "vitest"
import {
  resolveModelForAgent,
  resolveAgent,
  resolveAgentAndModel,
  resolveAgentSlug,
  getDefaultAgent,
  type CustomEndpoint,
  getAgentModels,
  resolveChatModel,
} from "@background-agents/common"

describe("resolveModelForAgent", () => {
  it("offers supported free models and resolves a retired saved selection", () => {
    const models = getAgentModels("opencode")
    expect(models.find(m => m.value === "opencode/mimo-v2.6-flash-free")?.requiresKey).toBe("none")
    expect(models.some(m => m.value === "opencode/mimo-v2.5-free")).toBe(false)
    expect(resolveChatModel("opencode", "opencode/mimo-v2.5-free", {})).not.toBe("opencode/mimo-v2.5-free")
  })
  it("honors a saved preference that belongs to the agent and is usable", () => {
    const model = resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, "gemini-3.1-pro-preview")
    expect(model).toBe("gemini-3.1-pro-preview")
  })

  it("ignores a saved preference the user can't use (locked), falling back to the agent default", () => {
    // No Gemini credentials → the preferred (locked) model is dropped in favor
    // of the standard default rather than landing the user on a dead end.
    const model = resolveModelForAgent("gemini", {}, "gemini-3.1-pro-preview")
    expect(model).not.toBe("gemini-3.1-pro-preview")
    expect(model).toBe("gemini-3.5-flash-lite") // hardcoded default for the agent
  })

  it("ignores a saved preference that belongs to a different agent", () => {
    // "opus" is a claude-code model; it must not leak into the gemini agent.
    const model = resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, "opus")
    expect(model).toBe("gemini-3.5-flash-lite")
  })

  it("falls back to the agent default when no preference is set", () => {
    expect(resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, null)).toBe("gemini-3.5-flash-lite")
    expect(resolveModelForAgent("gemini", { GEMINI_API_KEY: true }, undefined)).toBe("gemini-3.5-flash-lite")
  })

  it("honors a saved preference pointing at a custom endpoint when endpoints are supplied", () => {
    const endpoint: CustomEndpoint = {
      id: "e1",
      name: "My Endpoint",
      type: "opencode",
      baseUrl: "https://example.com",
      model: "some-model",
      headers: "",
    }
    const model = resolveModelForAgent("opencode", {}, "endpoint:e1", [endpoint])
    expect(model).toBe("endpoint:e1")
  })
})

describe("resolveAgent", () => {
  it("prefers the caller-preferred agent over everything", () => {
    expect(resolveAgent("gemini", "claude-code")).toBe("gemini")
  })

  it("falls back to the settings default when no preferred agent", () => {
    expect(resolveAgent(null, "claude-code")).toBe("claude-code")
    expect(resolveAgent(undefined, "gemini")).toBe("gemini")
  })

  it("falls back to the hardcoded default agent when nothing is set", () => {
    expect(resolveAgent(null, null)).toBe(getDefaultAgent())
  })
})

describe("resolveAgentAndModel", () => {
  it("resolves both, honoring preferred values first", () => {
    const result = resolveAgentAndModel(
      "gemini",
      "gemini-3.1-pro-preview",
      { defaultAgent: "claude-code", defaultModel: "opus" },
      { GEMINI_API_KEY: true }
    )
    expect(result).toEqual({ agent: "gemini", model: "gemini-3.1-pro-preview" })
  })

  it("falls back through settings to defaults when no preferred values", () => {
    const result = resolveAgentAndModel(
      null,
      null,
      { defaultAgent: "gemini", defaultModel: "gemini-3.1-pro-preview" },
      { GEMINI_API_KEY: true }
    )
    expect(result).toEqual({ agent: "gemini", model: "gemini-3.1-pro-preview" })
  })

  it("does not let a settings model from another agent leak in", () => {
    // defaultModel "opus" belongs to claude-code, but the resolved agent is
    // gemini → the mismatched model is dropped for gemini's default.
    const result = resolveAgentAndModel(
      "gemini",
      null,
      { defaultAgent: "claude-code", defaultModel: "opus" },
      { GEMINI_API_KEY: true }
    )
    expect(result).toEqual({ agent: "gemini", model: "gemini-3.5-flash-lite" })
  })
})

describe("resolveAgentSlug", () => {
  it("maps friendly aliases to their agent ids", () => {
    expect(resolveAgentSlug("factory")).toBe("droid")
    expect(resolveAgentSlug("claude")).toBe("claude-code")
  })

  it("maps canonical ids to themselves", () => {
    expect(resolveAgentSlug("kimi")).toBe("kimi")
    expect(resolveAgentSlug("opencode")).toBe("opencode")
    expect(resolveAgentSlug("claude-code")).toBe("claude-code")
  })

  it("is case-insensitive", () => {
    expect(resolveAgentSlug("Factory")).toBe("droid")
    expect(resolveAgentSlug("KIMI")).toBe("kimi")
  })

  it("returns null for unknown or empty slugs", () => {
    expect(resolveAgentSlug("bogus")).toBeNull()
    expect(resolveAgentSlug("")).toBeNull()
    expect(resolveAgentSlug(null)).toBeNull()
    expect(resolveAgentSlug(undefined)).toBeNull()
  })
})
