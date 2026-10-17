import { describe, expect, it } from "vitest"
import { gooseAgent } from "../src/agents/goose"
import { kimiAgent } from "../src/agents/kimi"
import type { CodeAgentSandbox } from "../src/types/provider"

describe("native invocation contracts", () => {
  it.each([gooseAgent, kimiAgent])("rejects unavailable thinking before launching %s", agent => {
    expect(() => agent.buildCommand({ model: "unverified-model", thinking: "high", prompt: "hello" })).toThrow("not supported")
    expect(() => agent.buildCommand({ model: "unverified-model", thinking: "default", prompt: "hello" })).not.toThrow()
  })

  it("resumes the requested Goose conversation instead of the most recent one", () => {
    const a = gooseAgent.buildCommand({ sessionId: "20261016_1", prompt: "A" }).args.join(" ")
    const b = gooseAgent.buildCommand({ sessionId: "20261016_2", prompt: "B" }).args.join(" ")
    expect(a).toContain("--session-id")
    expect(a).toContain("20261016_1")
    expect(b).toContain("20261016_2")
    expect(gooseAgent.buildCommand({ prompt: "New" }).args.join(" ")).not.toContain("--resume")
  })

  it("references Kimi credentials by environment name, never a literal key", async () => {
    const commands: string[] = []
    const sandbox = { executeCommand: async (command: string) => { commands.push(command); return { output: "", exitCode: 0 } } } as CodeAgentSandbox
    await kimiAgent.capabilities.setup!(sandbox, { KIMI_API_KEY: "test-secret-never-write" })
    const command = commands.join("\n")
    expect(command).toContain('api_key_env = "KIMI_API_KEY"')
    expect(command).not.toContain('[providers.kimi.env]')
    expect(command).not.toContain("test-secret-never-write")
    for (const model of ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"]) {
      const section = command.split(`[models."${model}"]`)[1]?.split("[models.")[0]
      expect(section).toContain('capabilities = ["thinking", "always_thinking"]')
    }
    for (const model of ["kimi-k2.5", "kimi-k2.6"]) {
      const section = command.split(`[models."${model}"]`)[1]?.split("[models.")[0]
      expect(section).toContain('capabilities = ["thinking"]')
    }
  })
})
