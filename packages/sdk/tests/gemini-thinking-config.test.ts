import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { geminiAgent } from "../src/agents/gemini"

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true }) })

async function fixture(settings: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "gemini-thinking-test-")); roots.push(root)
  await mkdir(join(root, ".gemini"))
  await mkdir(join(root, "bin"))
  await writeFile(join(root, ".gemini/settings.json"), JSON.stringify(settings))
  await writeFile(join(root, ".gemini/auth-marker"), "not-a-credential")
  await writeFile(join(root, "bin/gemini"), `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path');
const dir=p.join(process.env.GEMINI_CLI_HOME,'.gemini');
console.log(JSON.stringify({config:JSON.parse(fs.readFileSync(p.join(dir,'settings.json'))),
mode:fs.statSync(p.join(dir,'settings.json')).mode&511,dir:process.env.GEMINI_CLI_HOME,
auth:fs.readFileSync(p.join(dir,'auth-marker'),'utf8'),args:process.argv.slice(2)}));
`, { mode: 0o700 })
  async function run(thinking: string) {
    const spec = geminiAgent.buildCommand({ model: "gemini-2.5-flash", thinking, sessionId: "native-session", prompt: "quoted ' prompt" })
    return exec(spec.cmd, spec.args, { cwd: root, env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`,
      GEMINI_CLI_HOME: root, GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(root, "system.json"), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(root, "defaults.json") } })
  }
  return { root, run }
}

describe("isolated Gemini invocation configuration", () => {
  it("keeps concurrent budgets, permissions and resume independent without changing shared files", async () => {
    const f = await fixture({ security: { auth: { selectedType: "gemini-api-key" } }, ui: { theme: "Default" } })
    const before = await readFile(join(f.root, ".gemini/settings.json"), "utf8")
    const [a, b] = await Promise.all([f.run("budget:1024"), f.run("budget:2048")])
    const first = JSON.parse(a.stdout), second = JSON.parse(b.stdout)
    expect(first.config.modelConfigs.customOverrides[1].modelConfig.generateContentConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 })
    expect(second.config.modelConfigs.customOverrides[1].modelConfig.generateContentConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 })
    expect(first.dir).not.toBe(second.dir)
    expect(first.mode).toBe(0o600)
    expect(first.auth).toBe("not-a-credential")
    expect(first.args).toContain("native-session")
    expect(first.args).toContain("quoted ' prompt")
    expect(first.config.security.auth.selectedType).toBe("gemini-api-key")
    expect(await readFile(join(f.root, ".gemini/settings.json"), "utf8")).toBe(before)
    await expect(readFile(join(first.dir, ".gemini/settings.json"))).rejects.toThrow()
    const normal = JSON.parse((await f.run("default")).stdout)
    expect(normal.config.modelConfigs).toBeUndefined()
    expect(normal.dir).toBe(f.root)
  })
  it("refuses conflicting custom generation settings without launching or overwriting them", async () => {
    const f = await fixture({ modelConfigs: { customAliases: { custom: {} } } })
    const before = await readFile(join(f.root, ".gemini/settings.json"), "utf8")
    await expect(f.run("budget:1024")).rejects.toThrow("Cannot safely apply Gemini thinking")
    expect(await readFile(join(f.root, ".gemini/settings.json"), "utf8")).toBe(before)
    await expect(f.run("default")).resolves.toBeDefined()
  })
  it("does not discard malformed settings or retry an override as default", async () => {
    const f = await fixture()
    await writeFile(join(f.root, ".gemini/settings.json"), "{ /* preserve this file */ }")
    await expect(f.run("budget:1024")).rejects.toThrow("Choose Default")
    expect(await readFile(join(f.root, ".gemini/settings.json"), "utf8")).toContain("preserve this file")
  })
})
