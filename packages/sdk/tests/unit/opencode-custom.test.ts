/**
 * Unit tests for the custom OpenAI-compatible OpenCode endpoint ("OpenCode"
 * target on the Custom model tab).
 *
 * Two layers:
 *  - pure credential/model logic in @background-agents/common (env passthrough,
 *    model resolution to `custom/<model>`, the credential gate)
 *  - the SDK's opencode.json generation (buildOpencodeConfigJson)
 */
import { describe, it, expect } from "vitest"
import {
  getEnvForModel,
  buildOpencodeCustomEnv,
  resolveCliModel,
  hasCredentialsForModel,
  agentModels,
  CUSTOM_OPENCODE_MODEL_VALUE,
  type Credentials,
  type CredentialFlags,
} from "@background-agents/common"
import { buildOpencodeConfigJson } from "../../src/agents/opencode/config"

const opencodeCustomModel = agentModels["opencode"].find(
  (m) => m.value === CUSTOM_OPENCODE_MODEL_VALUE
)!

describe("buildOpencodeCustomEnv / getEnvForModel", () => {
  it("promotes the Authorization token (Bearer stripped) to CUSTOM_OPENCODE_API_KEY", () => {
    const creds: Credentials = {
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_OPENCODE_HEADERS: "Authorization: Bearer tok-1",
      CUSTOM_OPENCODE_NAME: "gpt-4o-mini",
    }
    const env = getEnvForModel(CUSTOM_OPENCODE_MODEL_VALUE, "opencode", creds)
    expect(env).toEqual({
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_OPENCODE_HEADERS: "Authorization: Bearer tok-1",
      CUSTOM_OPENCODE_NAME: "gpt-4o-mini",
      CUSTOM_OPENCODE_API_KEY: "tok-1",
    })
  })

  it("never leaks a stored OpenCode key into a custom run", () => {
    const env = getEnvForModel(CUSTOM_OPENCODE_MODEL_VALUE, "opencode", {
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      OPENCODE_API_KEY: "sk-SHOULD_NOT_LEAK",
    })
    expect(env.OPENCODE_API_KEY).toBeUndefined()
    expect(env.CUSTOM_OPENCODE_BASE_URL).toBe("https://gw.example.com/v1")
  })

  it("leaves CUSTOM_OPENCODE_API_KEY unset when no Authorization header is given", () => {
    const env = buildOpencodeCustomEnv({
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_OPENCODE_HEADERS: "x-api-key: sk-1",
    })
    expect(env.CUSTOM_OPENCODE_API_KEY).toBeUndefined()
    expect(env.CUSTOM_OPENCODE_HEADERS).toBe("x-api-key: sk-1")
  })
})

describe("resolveCliModel — opencode custom", () => {
  it("maps the sentinel to custom/<model id>", () => {
    expect(
      resolveCliModel(CUSTOM_OPENCODE_MODEL_VALUE, { CUSTOM_OPENCODE_NAME: "gpt-4o-mini" })
    ).toBe("custom/gpt-4o-mini")
  })

  it("returns undefined when no model id is set", () => {
    expect(resolveCliModel(CUSTOM_OPENCODE_MODEL_VALUE, {})).toBeUndefined()
  })
})

describe("hasCredentialsForModel — opencode custom", () => {
  it("requires only a base URL (auth is supplied via headers)", () => {
    const none: CredentialFlags = {}
    const baseOnly: CredentialFlags = { CUSTOM_OPENCODE_BASE_URL: true }

    expect(hasCredentialsForModel(opencodeCustomModel, none, "opencode")).toBe(false)
    expect(hasCredentialsForModel(opencodeCustomModel, baseOnly, "opencode")).toBe(true)
  })
})

describe("buildOpencodeConfigJson", () => {
  it("emits an openai-compatible provider with baseURL, apiKey env ref, and model map", () => {
    const json = JSON.parse(
      buildOpencodeConfigJson({
        baseUrl: "https://openrouter.ai/api/v1",
        model: "gpt-4o-mini",
        headers: "Authorization: Bearer tok-1\nX-Title: my-app",
        apiKeyEnv: "CUSTOM_OPENCODE_API_KEY",
      })
    )
    const provider = json.provider.custom
    expect(provider.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider.options.baseURL).toBe("https://openrouter.ai/api/v1")
    expect(provider.options.apiKey).toBe("{env:CUSTOM_OPENCODE_API_KEY}")
    // Authorization is carried by apiKey; only non-auth headers stay in headers.
    expect(provider.options.headers).toEqual({ "X-Title": "my-app" })
    expect(provider.models["gpt-4o-mini"]).toEqual({ name: "gpt-4o-mini" })
  })

  it("omits apiKey and headers when none are configured", () => {
    const json = JSON.parse(
      buildOpencodeConfigJson({ baseUrl: "https://gw.example.com/v1", model: "m1" })
    )
    const opts = json.provider.custom.options
    expect(opts.apiKey).toBeUndefined()
    expect(opts.headers).toBeUndefined()
    expect(opts.baseURL).toBe("https://gw.example.com/v1")
  })

  it("never writes the literal token into the file", () => {
    const out = buildOpencodeConfigJson({
      baseUrl: "https://gw.example.com/v1",
      model: "m1",
      headers: "Authorization: Bearer super-secret",
      apiKeyEnv: "CUSTOM_OPENCODE_API_KEY",
    })
    expect(out).not.toContain("super-secret")
  })
})
