import { describe, it, expect } from "vitest"
import { opencodeAgent } from "../../src/agents/opencode"
import { buildOpencodeInvocationEnv } from "../../src/agents/opencode/config"

describe("OpenCode invocation config ownership", () => {
  it("uses a native per-command overlay for an explicitly selected custom endpoint", () => {
    const command = opencodeAgent.buildCommand({
      prompt: "fixture",
      model: "custom/fixture-model",
      env: {
        CUSTOM_OPENCODE_BASE_URL: "https://gateway.invalid/v1",
        CUSTOM_OPENCODE_NAME: "fixture-model",
        CUSTOM_OPENCODE_API_KEY: "fixture-only-key",
      },
    })
    const config = JSON.parse(command.env!.OPENCODE_CONFIG_CONTENT)
    const [providerId] = Object.keys(config.provider)
    expect(providerId).toMatch(/^backgrounder-custom-[a-f0-9-]+$/)
    expect(config.provider[providerId].options).toEqual({
      baseURL: "https://gateway.invalid/v1",
      apiKey: "{env:CUSTOM_OPENCODE_API_KEY}",
    })
    expect(config.provider[providerId].models["fixture-model"]).toEqual({ name: "fixture-model" })
    expect(command.env!.OPENCODE_CONFIG_CONTENT).not.toContain("fixture-only-key")
    expect(command.args!.join(" ")).toContain(`${providerId}/fixture-model`)
  })

  it("preserves inline MCP, global options and unrelated provider variants", () => {
    const existing = {
      permission: "ask",
      mcp: { fixture: { type: "local", command: ["fixture-mcp"] } },
      provider: { openai: { models: { fixture: { variants: { review: { reasoningEffort: "high" } } } } } },
    }
    const env = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(existing),
      CUSTOM_OPENCODE_BASE_URL: "https://gateway.invalid/v1",
      CUSTOM_OPENCODE_NAME: "fixture-model",
    }
    const result = buildOpencodeInvocationEnv(env)
    const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT)
    expect(config.mcp).toEqual(existing.mcp)
    expect(config.permission).toBe(existing.permission)
    expect(config.provider.openai).toEqual(existing.provider.openai)
    expect(env.OPENCODE_CONFIG_CONTENT).toBe(JSON.stringify(existing))
  })

  it("does not carry the generated custom overlay into a later standard-provider command", () => {
    const custom = opencodeAgent.buildCommand({ prompt: "custom", model: "custom/fixture", env: {
      CUSTOM_OPENCODE_BASE_URL: "https://gateway.invalid/v1", CUSTOM_OPENCODE_NAME: "fixture",
    } })
    const standard = opencodeAgent.buildCommand({ prompt: "standard", model: "openai/fixture", env: {} })
    expect(custom.env?.OPENCODE_CONFIG_CONTENT).toBeDefined()
    expect(standard.env?.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(opencodeAgent.capabilities?.setup).toBeUndefined()
  })

  it("never removes a user custom provider by name when returning to the standard path", () => {
    const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { custom: { name: "User provider" } } }) }
    const result = buildOpencodeInvocationEnv(env)
    expect(result).toEqual(env)
    expect(result).not.toBe(env)
  })

  it("isolates a selected endpoint from the user provider named custom", () => {
    const userProvider = { options: { apiKey: "fixture-user-secret", headers: { "X-User": "private" } }, models: { old: {} } }
    const command = opencodeAgent.buildCommand({
      prompt: "fixture", model: "custom/anonymous-model",
      env: {
        CUSTOM_OPENCODE_BASE_URL: "https://anonymous.invalid/v1",
        CUSTOM_OPENCODE_NAME: "anonymous-model",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { custom: userProvider } }),
      },
    })
    const config = JSON.parse(command.env!.OPENCODE_CONFIG_CONTENT)
    expect(config.provider.custom).toEqual(userProvider)
    const owned = Object.keys(config.provider).find(key => key.startsWith("backgrounder-custom-"))
    expect(owned).toBeDefined()
    expect(config.provider[owned!].options).toEqual({ baseURL: "https://anonymous.invalid/v1" })
    expect(command.args!.join(" ")).toContain(`${owned}/anonymous-model`)
  })

  it.each(["invalid {", "null", "[]", '{"provider":[]}'])("refuses to overwrite malformed inline config: %s", (content) => {
    expect(() => buildOpencodeInvocationEnv({
      OPENCODE_CONFIG_CONTENT: content,
      CUSTOM_OPENCODE_BASE_URL: "https://gateway.invalid/v1",
    })).toThrow(/Cannot configure the custom OpenCode endpoint/)
  })
})
