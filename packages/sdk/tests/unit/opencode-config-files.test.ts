import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { opencodeAgent } from "../../src/agents/opencode"
import type { CodeAgentSandbox } from "../../src/types/provider"

const exec = promisify(execFile)
const roots: string[] = []

/** Run the real setup shell commands against isolated files, not a command mock. */
async function fileSandbox(global: string, project: string) {
  const root = await mkdtemp(join(tmpdir(), "backgrounder-opencode-config-"))
  roots.push(root)
  const cwd = join(root, "project")
  const configDir = join(root, ".config", "opencode")
  await mkdir(cwd, { recursive: true })
  await mkdir(configDir, { recursive: true })
  const globalPath = join(configDir, "opencode.json")
  const projectPath = join(cwd, "opencode.json")
  await writeFile(globalPath, global)
  await writeFile(projectPath, project)
  const sandbox: CodeAgentSandbox = {
    ensureProvider: async () => {},
    setEnvVars: () => {},
    async executeCommand(command, timeout) {
      // Map the adapter's old fixed sandbox checkout into this test's temp root.
      const isolated = command.replaceAll("/home/daytona/project", cwd)
      const result = await exec("bash", ["-c", isolated], {
        cwd,
        env: { ...process.env, HOME: root },
        timeout: (timeout ?? 10) * 1000,
      })
      return { exitCode: 0, output: result.stdout }
    },
  }
  return { sandbox, cwd, globalPath, projectPath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("OpenCode setup config ownership (isolated filesystem)", () => {
  it("preserves global and project variants under the same provider and project MCP", async () => {
    const global = JSON.stringify({
      provider: { openai: { models: { "gpt-fixture": { variants: { low: { reasoningEffort: "low" } } } } } },
      mcp: { globalTool: { type: "remote", url: "https://global.invalid/mcp" } },
    }, null, 2)
    const project = JSON.stringify({
      provider: { openai: { models: { "gpt-fixture": { variants: { "deep-review": { reasoningEffort: "high" } } } } } },
      mcp: { projectTool: { type: "local", command: ["fixture-mcp"] } },
    }, null, 2)
    const fs = await fileSandbox(global, project)

    await opencodeAgent.capabilities?.setup?.(fs.sandbox, {})

    expect(await readFile(fs.projectPath, "utf8")).toBe(project)
    expect(await readFile(fs.globalPath, "utf8")).toBe(global)
  })

  it("never removes a tracked repository config or treats its shape as ownership proof", async () => {
    const project = JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: {} })
    const fs = await fileSandbox("{}", project)
    await exec("git", ["init", "-q"], { cwd: fs.cwd })
    await exec("git", ["add", "opencode.json"], { cwd: fs.cwd })

    await opencodeAgent.capabilities?.setup?.(fs.sandbox, {})

    expect(await readFile(fs.projectPath, "utf8")).toBe(project)
    expect((await exec("git", ["diff", "--name-only"], { cwd: fs.cwd })).stdout).toBe("")
  })

  it("preserves malformed user project config for OpenCode to diagnose", async () => {
    const project = "{ // user is editing this file\n"
    const fs = await fileSandbox("{}", project)

    await opencodeAgent.capabilities?.setup?.(fs.sandbox, {})

    expect(await readFile(fs.projectPath, "utf8")).toBe(project)
  })

  it("leaves user config and MCP byte-identical across custom and standard invocations", async () => {
    const global = JSON.stringify({ provider: { custom: { name: "User-owned custom" } }, mcp: { user: { type: "local", command: ["fixture-mcp"] } } })
    const project = JSON.stringify({ provider: { custom: { models: { user: { variants: { review: {} } } } } } })
    const fs = await fileSandbox(global, project)
    const customEnv = { CUSTOM_OPENCODE_BASE_URL: "https://gateway.invalid/v1", CUSTOM_OPENCODE_NAME: "fixture" }
    await opencodeAgent.capabilities?.setup?.(fs.sandbox, customEnv)
    const custom = opencodeAgent.buildCommand({ prompt: "fixture", model: "custom/fixture", env: customEnv })
    await opencodeAgent.capabilities?.setup?.(fs.sandbox, {})
    const standard = opencodeAgent.buildCommand({ prompt: "fixture", model: "openai/fixture", env: {} })

    expect(custom.env?.OPENCODE_CONFIG_CONTENT).toContain("https://gateway.invalid/v1")
    expect(standard.env?.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(await readFile(fs.globalPath, "utf8")).toBe(global)
    expect(await readFile(fs.projectPath, "utf8")).toBe(project)
  })
})
