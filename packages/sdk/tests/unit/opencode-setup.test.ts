/**
 * Unit tests for opencodeSetup (opencodeAgent.capabilities.setup).
 *
 * Focus: the global opencode.json is read-modify-written so it never lands in
 * the repo working tree, the `mcp` section written earlier by setupMcpForAgent
 * survives, and a legacy project-root opencode.json left by older builds is
 * relocated out of the tree.
 */
import { describe, it, expect } from "vitest"
import type { CodeAgentSandbox } from "../../src/types/provider"
import { opencodeAgent } from "../../src/agents/opencode"

const GLOBAL_PATH = "~/.config/opencode/opencode.json"
const PROJECT_PATH = "/home/daytona/project/opencode.json"

/** In-memory sandbox that interprets the handful of shell commands setup emits. */
function fakeSandbox(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial }
  const removed: string[] = []

  const sandbox: CodeAgentSandbox = {
    ensureProvider: async () => {},
    setEnvVars: () => {},
    async executeCommand(command: string) {
      const cat = command.match(/^cat (\S+) /)
      if (cat) {
        const path = cat[1]
        if (path in files) return { exitCode: 0, output: files[path] }
        // Reproduce the shell fallbacks: `|| echo '{}'` vs `|| true`.
        return { exitCode: 0, output: command.includes("echo '{}'") ? "{}" : "" }
      }
      const rm = command.match(/^rm -f (\S+)/)
      if (rm) {
        delete files[rm[1]]
        removed.push(rm[1])
        return { exitCode: 0, output: "" }
      }
      const write = command.match(/printf '%s' '([^']*)' > (\S+)/)
      if (write) {
        files[write[2]] = write[1]
        return { exitCode: 0, output: "" }
      }
      return { exitCode: 0, output: "" }
    },
  }

  return { sandbox, files, removed }
}

async function runSetup(
  fs: ReturnType<typeof fakeSandbox>,
  env: Record<string, string> = {}
) {
  await opencodeAgent.capabilities!.setup!(fs.sandbox, env)
}

const mcp = (name: string) => ({
  [name]: { type: "remote", url: `https://${name}`, enabled: true },
})

describe("opencodeSetup — legacy project-root relocation", () => {
  it("moves a stale project-root config into the global file and deletes it", async () => {
    const fs = fakeSandbox({
      [PROJECT_PATH]: JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        mcp: mcp("github"),
      }),
    })

    await runSetup(fs)

    expect(fs.removed).toContain(PROJECT_PATH)
    expect(PROJECT_PATH in fs.files).toBe(false)
    const global = JSON.parse(fs.files[GLOBAL_PATH])
    expect(global.mcp).toEqual(mcp("github"))
  })

  it("does not resurrect stale mcp when the global file already has one", async () => {
    const fs = fakeSandbox({
      [GLOBAL_PATH]: JSON.stringify({ mcp: mcp("current") }),
      [PROJECT_PATH]: JSON.stringify({ mcp: mcp("stale") }),
    })

    await runSetup(fs)

    expect(fs.removed).toContain(PROJECT_PATH)
    const global = JSON.parse(fs.files[GLOBAL_PATH])
    expect(global.mcp).toEqual(mcp("current"))
  })

  it("deletes a junk project-root file without touching the global config", async () => {
    const fs = fakeSandbox({ [PROJECT_PATH]: "not json {{{" })

    await runSetup(fs)

    expect(fs.removed).toContain(PROJECT_PATH)
    expect(GLOBAL_PATH in fs.files).toBe(false)
  })

  it("is a no-op when there is no project-root file and nothing to strip", async () => {
    const fs = fakeSandbox()

    await runSetup(fs)

    expect(fs.removed).toHaveLength(0)
    expect(GLOBAL_PATH in fs.files).toBe(false)
  })
})

describe("opencodeSetup — custom endpoint", () => {
  it("merges a custom provider while preserving the mcp section", async () => {
    const fs = fakeSandbox({
      [GLOBAL_PATH]: JSON.stringify({ mcp: mcp("github") }),
    })

    await runSetup(fs, {
      CUSTOM_OPENCODE_BASE_URL: "https://gw.example.com/v1",
      CUSTOM_OPENCODE_NAME: "gpt-4o-mini",
      CUSTOM_OPENCODE_API_KEY: "tok",
    })

    const global = JSON.parse(fs.files[GLOBAL_PATH])
    expect(global.mcp).toEqual(mcp("github"))
    expect(global.provider.custom.options.baseURL).toBe("https://gw.example.com/v1")
    expect(global.provider.custom.options.apiKey).toBe("{env:CUSTOM_OPENCODE_API_KEY}")
    expect(global.$schema).toBe("https://opencode.ai/config.json")
  })
})

describe("opencodeSetup — standard path", () => {
  it("strips a leftover custom provider but keeps mcp", async () => {
    const fs = fakeSandbox({
      [GLOBAL_PATH]: JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: { custom: { npm: "@ai-sdk/openai-compatible" } },
        mcp: mcp("github"),
      }),
    })

    await runSetup(fs)

    const global = JSON.parse(fs.files[GLOBAL_PATH])
    expect(global.provider).toBeUndefined()
    expect(global.mcp).toEqual(mcp("github"))
  })
})
