/**
 * Unit tests for the custom OpenAI-compatible Codex endpoint ("Custom Codex").
 *
 * Two layers:
 *  - pure credential/model logic in @background-agents/common (env passthrough,
 *    model resolution, the credential gate)
 *  - the SDK's config.toml generation (buildCodexConfigToml / parseHeaderLines)
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildCodexCustomEnv,
  resolveCliModel,
  hasCredentialsForModel,
  agentModels,
  CUSTOM_CODEX_MODEL_VALUE,
  type Credentials,
  type CredentialFlags,
} from "@background-agents/common"
import { buildCodexConfigToml } from "../../src/agents/codex/config"
import { parseHeaderLines } from "../../src/utils/headers"

const codexCustomModel = agentModels["codex"].find(
  (m) => m.value === CUSTOM_CODEX_MODEL_VALUE
)!

describe("buildCodexCustomEnv / getEnvForModel", () => {
  it("copies the full Authorization value (Bearer kept) to CUSTOM_CODEX_AUTHORIZATION", () => {
    const creds: Credentials = {
      CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_CODEX_HEADERS: "Authorization: Bearer tok-1",
      CUSTOM_CODEX_NAME: "gpt-5.5",
    }
    const env = getEnvForModel(CUSTOM_CODEX_MODEL_VALUE, "codex", creds)
    expect(env).toEqual({
      CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_CODEX_HEADERS: "Authorization: Bearer tok-1",
      CUSTOM_CODEX_NAME: "gpt-5.5",
      CUSTOM_CODEX_AUTHORIZATION: "Bearer tok-1",
    })
  })

  it("leaves CUSTOM_CODEX_AUTHORIZATION unset when no Authorization header is given", () => {
    const env = buildCodexCustomEnv({
      CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_CODEX_HEADERS: "x-api-key: sk-1",
    })
    expect(env.CUSTOM_CODEX_AUTHORIZATION).toBeUndefined()
    expect(env.CUSTOM_CODEX_HEADERS).toBe("x-api-key: sk-1")
  })

  it("never leaks a stored OpenAI key into a custom Codex run", () => {
    const env = getEnvForModel(CUSTOM_CODEX_MODEL_VALUE, "codex", {
      CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1",
      OPENAI_API_KEY: "sk-SHOULD_NOT_LEAK",
    })
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.CUSTOM_CODEX_BASE_URL).toBe("https://gw.example.com/v1")
  })

  it("only sets the base URL when no headers/model are configured", () => {
    expect(buildCodexCustomEnv({ CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1" })).toEqual({
      CUSTOM_CODEX_BASE_URL: "https://gw.example.com/v1",
    })
  })
})

describe("resolveCliModel — codex custom", () => {
  it("translates the codex-custom sentinel to the configured model name", () => {
    expect(
      resolveCliModel(CUSTOM_CODEX_MODEL_VALUE, { CUSTOM_CODEX_NAME: "gpt-5.5" })
    ).toBe("gpt-5.5")
  })

  it("returns undefined when no model name is set (endpoint default)", () => {
    expect(resolveCliModel(CUSTOM_CODEX_MODEL_VALUE, {})).toBeUndefined()
  })
})

describe("hasCredentialsForModel — codex custom", () => {
  it("requires only a base URL (auth is supplied via headers)", () => {
    const none: CredentialFlags = {}
    const baseOnly: CredentialFlags = { CUSTOM_CODEX_BASE_URL: true }
    const headersOnly: CredentialFlags = { CUSTOM_CODEX_HEADERS: true }

    expect(hasCredentialsForModel(codexCustomModel, none, "codex")).toBe(false)
    expect(hasCredentialsForModel(codexCustomModel, headersOnly, "codex")).toBe(false)
    expect(hasCredentialsForModel(codexCustomModel, baseOnly, "codex")).toBe(true)
  })
})

describe("parseHeaderLines", () => {
  it("keeps ordered name/value pairs and skips blanks and comments", () => {
    expect(
      parseHeaderLines("Authorization: Bearer tok\n\n# a comment\nX-Org: org_1\nbadline")
    ).toEqual([
      ["Authorization", "Bearer tok"],
      ["X-Org", "org_1"],
    ])
  })
})

describe("buildCodexConfigToml", () => {
  it("routes Authorization via env_http_headers and keeps other headers static", () => {
    const toml = buildCodexConfigToml({
      baseUrl: "https://gw.example.com/v1",
      model: "gpt-5.5",
      headers: "Authorization: Bearer tok-1\nX-Org: org_1",
      authHeaderEnv: "CUSTOM_CODEX_AUTHORIZATION",
    })
    expect(toml).toContain(`model_provider = "custom"`)
    expect(toml).toContain(`model = "gpt-5.5"`)
    expect(toml).toContain(`[model_providers.custom]`)
    expect(toml).toContain(`base_url = "https://gw.example.com/v1"`)
    expect(toml).toContain(`wire_api = "responses"`)
    expect(toml).not.toContain("env_key")
    // X-Org stays in static http_headers; Authorization is env-backed.
    expect(toml).toContain(`[model_providers.custom.http_headers]`)
    expect(toml).toContain(`"X-Org" = "org_1"`)
    expect(toml).toContain(`[model_providers.custom.env_http_headers]`)
    expect(toml).toContain(`"Authorization" = "CUSTOM_CODEX_AUTHORIZATION"`)
  })

  it("omits static http_headers when Authorization is the only header", () => {
    const toml = buildCodexConfigToml({
      baseUrl: "https://gw.example.com/v1",
      headers: "Authorization: Bearer tok-1",
      authHeaderEnv: "CUSTOM_CODEX_AUTHORIZATION",
    })
    expect(toml).not.toContain("[model_providers.custom.http_headers]")
    expect(toml).toContain(`[model_providers.custom.env_http_headers]`)
    expect(toml).toContain(`"Authorization" = "CUSTOM_CODEX_AUTHORIZATION"`)
    // The literal token must never appear in the file — it's env-backed.
    expect(toml).not.toContain("Bearer tok-1")
  })

  it("omits the model line and headers table when unset", () => {
    const toml = buildCodexConfigToml({ baseUrl: "https://gw.example.com/v1" })
    expect(toml).not.toContain("model =")
    expect(toml).not.toContain("http_headers")
  })

  it("escapes double quotes and backslashes in values", () => {
    const toml = buildCodexConfigToml({
      baseUrl: "https://gw.example.com/v1",
      headers: 'X-Weird: a"b\\c',
    })
    expect(toml).toContain(`"X-Weird" = "a\\"b\\\\c"`)
  })
})
