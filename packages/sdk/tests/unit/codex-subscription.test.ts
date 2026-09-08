/**
 * The ChatGPT-subscription credential for Codex: which runs it unlocks, and
 * which env var reaches the sandbox.
 */
import { describe, it, expect } from "vitest"
import { getEnvForModel, hasCredentialsForModel, agentModels } from "@background-agents/common"

const codexModel = agentModels.codex.find((m) => m.requiresKey === "openai")!

describe("hasCredentialsForModel with CODEX_CREDENTIALS", () => {
  it("unlocks an OpenAI model under the codex agent", () => {
    expect(hasCredentialsForModel(codexModel, { CODEX_CREDENTIALS: true }, "codex")).toBe(true)
  })

  it("still unlocks it with only an API key", () => {
    expect(hasCredentialsForModel(codexModel, { OPENAI_API_KEY: true }, "codex")).toBe(true)
  })

  it("stays locked with neither", () => {
    expect(hasCredentialsForModel(codexModel, {}, "codex")).toBe(false)
  })

  it("does NOT unlock OpenAI models under other agents — a ChatGPT plan is Codex-only", () => {
    // goose lists gpt-4o with requiresKey "openai"; a subscription must not touch it.
    const gooseModel = agentModels.goose.find((m) => m.requiresKey === "openai")!
    expect(hasCredentialsForModel(gooseModel, { CODEX_CREDENTIALS: true }, "goose")).toBe(false)
    expect(hasCredentialsForModel(gooseModel, { OPENAI_API_KEY: true }, "goose")).toBe(true)
  })
})

describe("getEnvForModel with CODEX_CREDENTIALS", () => {
  it("prefers the subscription over a stored API key for codex", () => {
    const env = getEnvForModel(codexModel.value, "codex", {
      CODEX_CREDENTIALS: "{\"tokens\":{}}",
      OPENAI_API_KEY: "sk-should-not-be-used",
    })
    expect(env).toEqual({ CODEX_CREDENTIALS: "{\"tokens\":{}}" })
  })

  it("falls back to the API key when no subscription is stored", () => {
    const env = getEnvForModel(codexModel.value, "codex", { OPENAI_API_KEY: "sk-1" })
    expect(env).toEqual({ OPENAI_API_KEY: "sk-1" })
  })

  it("never leaks the subscription blob to a non-codex agent", () => {
    const env = getEnvForModel(codexModel.value, "pi", { CODEX_CREDENTIALS: "{}" })
    expect(env.CODEX_CREDENTIALS).toBeUndefined()
  })
})
