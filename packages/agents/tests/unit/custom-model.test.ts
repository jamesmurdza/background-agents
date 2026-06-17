/**
 * Unit tests for the custom Anthropic-compatible endpoint ("Custom model").
 *
 * Covers the mapping of stored CUSTOM_MODEL_* credentials to the standard
 * ANTHROPIC_* env vars, header sanitization, CLI model resolution, and the
 * credential gate — all pure logic in @background-agents/common.
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildCustomModelEnv,
  sanitizeCustomHeaders,
  resolveCliModel,
  hasCredentialsForModel,
  agentModels,
  CUSTOM_MODEL_VALUE,
  type Credentials,
  type CredentialFlags,
} from "@background-agents/common"

const customModel = agentModels["claude-code"].find((m) => m.value === CUSTOM_MODEL_VALUE)!

describe("custom model env injection", () => {
  it("maps API key config to ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY", () => {
    const creds: Credentials = {
      CUSTOM_MODEL_BASE_URL: "https://api.anthropic.com",
      CUSTOM_MODEL_API_KEY: "sk-ant-123",
    }
    const env = getEnvForModel(CUSTOM_MODEL_VALUE, "claude-code", creds)
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-123",
    })
  })

  it("maps auth-token config to ANTHROPIC_AUTH_TOKEN", () => {
    const env = buildCustomModelEnv({
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_AUTH_TOKEN: "tok-456",
    })
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://gateway.example.com",
      ANTHROPIC_AUTH_TOKEN: "tok-456",
    })
  })

  it("never leaks the shared-pool token even if one is stored", () => {
    const env = getEnvForModel(CUSTOM_MODEL_VALUE, "claude-code", {
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_API_KEY: "sk-custom",
      CLAUDE_CODE_CREDENTIALS: '{"claudeAiOauth":{"accessToken":"SHOULD_NOT_LEAK"}}',
    })
    expect(env.CLAUDE_CODE_CREDENTIALS).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe("sk-custom")
  })

  it("passes through sanitized custom headers and drops blocklisted ones", () => {
    const env = buildCustomModelEnv({
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_API_KEY: "sk-custom",
      CUSTOM_MODEL_HEADERS: "x-org-id: org_1\nAuthorization: Bearer hack\nx-route: prod",
    })
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe("x-org-id: org_1\nx-route: prod")
  })
})

describe("sanitizeCustomHeaders", () => {
  it("drops blocklisted, empty, and malformed lines", () => {
    expect(
      sanitizeCustomHeaders("x-a: 1\n\nx-api-key: nope\nbadline\nanthropic-version: 1\nx-b: 2")
    ).toBe("x-a: 1\nx-b: 2")
  })

  it("returns undefined when nothing valid remains", () => {
    expect(sanitizeCustomHeaders("Authorization: Bearer x\n\n")).toBeUndefined()
  })
})

describe("resolveCliModel", () => {
  it("translates the custom sentinel to the configured model name", () => {
    expect(resolveCliModel(CUSTOM_MODEL_VALUE, { CUSTOM_MODEL_NAME: "claude-opus-4-1" })).toBe(
      "claude-opus-4-1"
    )
  })

  it("returns undefined for a custom run with no model name (endpoint default)", () => {
    expect(resolveCliModel(CUSTOM_MODEL_VALUE, {})).toBeUndefined()
  })

  it("passes regular model values through unchanged", () => {
    expect(resolveCliModel("sonnet", {})).toBe("sonnet")
  })
})

describe("hasCredentialsForModel — custom", () => {
  it("requires a base URL plus at least one auth credential", () => {
    const baseOnly: CredentialFlags = { CUSTOM_MODEL_BASE_URL: true }
    const withApiKey: CredentialFlags = { CUSTOM_MODEL_BASE_URL: true, CUSTOM_MODEL_API_KEY: true }
    const withToken: CredentialFlags = { CUSTOM_MODEL_BASE_URL: true, CUSTOM_MODEL_AUTH_TOKEN: true }
    const authOnly: CredentialFlags = { CUSTOM_MODEL_API_KEY: true }

    expect(hasCredentialsForModel(customModel, baseOnly, "claude-code")).toBe(false)
    expect(hasCredentialsForModel(customModel, authOnly, "claude-code")).toBe(false)
    expect(hasCredentialsForModel(customModel, withApiKey, "claude-code")).toBe(true)
    expect(hasCredentialsForModel(customModel, withToken, "claude-code")).toBe(true)
  })
})
