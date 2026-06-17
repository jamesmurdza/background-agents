/**
 * Unit tests for the custom Anthropic-compatible endpoint ("Custom model").
 *
 * Covers the mapping of stored CUSTOM_MODEL_* credentials to the standard
 * ANTHROPIC_* env vars, header parsing / auth promotion, CLI model resolution,
 * and the credential gate — all pure logic in @background-agents/common.
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildCustomModelEnv,
  parseCustomHeaders,
  resolveCliModel,
  hasCredentialsForModel,
  agentModels,
  CUSTOM_MODEL_VALUE,
  type Credentials,
  type CredentialFlags,
} from "@background-agents/common"

const customModel = agentModels["claude-code"].find((m) => m.value === CUSTOM_MODEL_VALUE)!

describe("custom model env injection", () => {
  it("promotes an x-api-key header to ANTHROPIC_API_KEY", () => {
    const creds: Credentials = {
      CUSTOM_MODEL_BASE_URL: "https://api.anthropic.com",
      CUSTOM_MODEL_HEADERS: "x-api-key: sk-ant-123",
    }
    const env = getEnvForModel(CUSTOM_MODEL_VALUE, "claude-code", creds)
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_API_KEY: "sk-ant-123",
    })
  })

  it("promotes an Authorization header to ANTHROPIC_AUTH_TOKEN (Bearer stripped)", () => {
    const env = buildCustomModelEnv({
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_HEADERS: "Authorization: Bearer tok-456",
    })
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://gateway.example.com",
      ANTHROPIC_AUTH_TOKEN: "tok-456",
    })
  })

  it("never leaks the shared-pool token even if one is stored", () => {
    const env = getEnvForModel(CUSTOM_MODEL_VALUE, "claude-code", {
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_HEADERS: "x-api-key: sk-custom",
      CLAUDE_CODE_CREDENTIALS: '{"claudeAiOauth":{"accessToken":"SHOULD_NOT_LEAK"}}',
    })
    expect(env.CLAUDE_CODE_CREDENTIALS).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe("sk-custom")
  })

  it("keeps non-auth headers in ANTHROPIC_CUSTOM_HEADERS alongside promoted auth", () => {
    const env = buildCustomModelEnv({
      CUSTOM_MODEL_BASE_URL: "https://gateway.example.com",
      CUSTOM_MODEL_HEADERS: "x-org-id: org_1\nx-api-key: sk-custom\nx-route: prod",
    })
    expect(env.ANTHROPIC_API_KEY).toBe("sk-custom")
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe("x-org-id: org_1\nx-route: prod")
  })

  it("only sets the base URL when no headers are configured", () => {
    const env = buildCustomModelEnv({ CUSTOM_MODEL_BASE_URL: "https://api.anthropic.com" })
    expect(env).toEqual({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })
  })
})

describe("parseCustomHeaders", () => {
  it("extracts auth headers, drops anthropic-version, and keeps the rest", () => {
    const parsed = parseCustomHeaders(
      "x-a: 1\n\nx-api-key: sk-1\nbadline\nanthropic-version: 1\nAuthorization: Bearer tok\nx-b: 2"
    )
    expect(parsed).toEqual({
      apiKey: "sk-1",
      authToken: "tok",
      headers: "x-a: 1\nx-b: 2",
    })
  })

  it("returns no headers blob when only auth lines remain", () => {
    expect(parseCustomHeaders("Authorization: Bearer x\n\n")).toEqual({
      authToken: "x",
      apiKey: undefined,
      headers: undefined,
    })
  })

  it("accepts an Authorization value without a Bearer prefix", () => {
    expect(parseCustomHeaders("Authorization: tok-raw").authToken).toBe("tok-raw")
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
  it("requires only a base URL (auth is supplied via headers)", () => {
    const none: CredentialFlags = {}
    const baseOnly: CredentialFlags = { CUSTOM_MODEL_BASE_URL: true }
    const headersOnly: CredentialFlags = { CUSTOM_MODEL_HEADERS: true }

    expect(hasCredentialsForModel(customModel, none, "claude-code")).toBe(false)
    expect(hasCredentialsForModel(customModel, headersOnly, "claude-code")).toBe(false)
    expect(hasCredentialsForModel(customModel, baseOnly, "claude-code")).toBe(true)
  })
})
