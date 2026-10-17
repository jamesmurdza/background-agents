import { describe, expect, it, vi } from "vitest"
import { agentModels, defaultAgentModel } from "../../common/src/agents"
import { piAgent } from "../src/agents/pi"
import { getRuntimeThinkingCapability, verifyThinkingRuntime } from "../src/thinking-runtime"
import { getVerifiedThinkingCapability, validateThinking } from "../src/thinking"
import type { CodeAgentSandbox } from "../src/types/provider"

/** Controlled registry response, not a statement about provider availability. */
function registry(found = true, levels: string[] = ["low", "high"]) {
  const executeCommand = vi.fn(async (_command: string) => ({ exitCode: 0, output: JSON.stringify({ found, levels }) }))
  const sandbox: CodeAgentSandbox = { ensureProvider: async () => {}, setEnvVars: () => {}, executeCommand }
  return { sandbox, executeCommand }
}

describe("Pi selector identities across discovery, validation and invocation", () => {
  it.each(agentModels.pi.map(option => option.value))("keeps %s on the same exact provider/model throughout", async model => {
    const canonical = model.startsWith("claude-") ? `anthropic/${model}` : model
    const { sandbox, executeCommand } = registry()
    const capability = await getRuntimeThinkingCapability("pi", model, sandbox)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand.mock.calls[0]?.[0]).toContain(`'${canonical}'`)
    expect(capability).toMatchObject({ status: "available", levels: ["low", "high"] })
    expect(validateThinking("pi", model, "high")).toBe("high")
    await expect(verifyThinkingRuntime("pi", { model, thinking: "high" }, sandbox)).resolves.toBeUndefined()
    await expect(verifyThinkingRuntime("pi", { model, thinking: "medium" }, sandbox)).rejects.toThrow("does not advertise")

    const command = piAgent.buildCommand({ model, thinking: "high", sessionId: "pi-chat", prompt: "continue" })
    expect(command.args[command.args.indexOf("--model") + 1]).toBe(canonical)
    expect(command.args[command.args.indexOf("--thinking") + 1]).toBe("high")
    expect(command.args[command.args.indexOf("--session") + 1]).toBe("pi-chat")
    // Normalization must not turn a syntax match into first-prompt support.
    expect(getVerifiedThinkingCapability("pi", model)).toMatchObject({ status: "unverified", levels: [] })
  })

  it("checks the actual Pi default and its explicit Anthropic identity equivalently", async () => {
    const model = defaultAgentModel.pi
    expect(agentModels.pi.some(option => option.value === model)).toBe(true)
    const runtime = registry()
    const bare = await getRuntimeThinkingCapability("pi", model, runtime.sandbox)
    const qualified = await getRuntimeThinkingCapability("pi", `anthropic/${model}`, runtime.sandbox)
    expect(bare).toEqual(qualified)
    expect(runtime.executeCommand.mock.calls[0]?.[0]).toEqual(runtime.executeCommand.mock.calls[1]?.[0])
    const command = piAgent.buildCommand({ model, thinking: "default", prompt: "continue" })
    expect(command.args).toContain(`anthropic/${model}`)
    expect(command.args).not.toContain("--thinking")
  })

  it.each(["claude-not-in-this-registry", "anthropic/unknown-model", "openai/unknown-model", "google/unknown-model"])("keeps missing registry model %s unverified", async model => {
    const { sandbox, executeCommand } = registry(false, [])
    const capability = await getRuntimeThinkingCapability("pi", model, sandbox)
    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(capability).toMatchObject({ status: "unverified", levels: [] })
    await expect(verifyThinkingRuntime("pi", { model, thinking: "high" }, sandbox)).rejects.toThrow("does not contain")
  })

  it.each(["unknown-model", "custom/claude-opus-4-7", "endpoint:private", "claude-model; echo bad"])("does not infer a provider or controls for %s", async model => {
    const { sandbox, executeCommand } = registry()
    expect(await getRuntimeThinkingCapability("pi", model, sandbox)).toMatchObject({ status: "unverified", levels: [] })
    expect(executeCommand).not.toHaveBeenCalled()
    expect(() => validateThinking("pi", model, "high")).toThrow("not supported")
    const command = piAgent.buildCommand({ model, thinking: "default" })
    expect(command.args[command.args.indexOf("--model") + 1]).toBe(model)
  })
})
