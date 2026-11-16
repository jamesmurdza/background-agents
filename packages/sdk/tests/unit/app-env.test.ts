/**
 * Unit tests for keeping the user's app env vars away from the agent CLI
 * (hideHarnessEnvKeys in @background-agents/common) while still handing them
 * to the agent's shell commands (the SDK's app env hook).
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hideHarnessEnvKeys, APP_ENV_REMAP_ENV as COMMON_REMAP_ENV } from "@background-agents/common"
import {
  APP_ENV_ARMED_ENV,
  APP_ENV_HOOK_FILE,
  APP_ENV_HOOK_SCRIPT,
  APP_ENV_REMAP_ENV,
  applyAppEnvHook,
} from "../../src/utils/app-env"

describe("hideHarnessEnvKeys", () => {
  it("renames names the agent CLI reads and lists them for the hook", () => {
    const env = hideHarnessEnvKeys({ ANTHROPIC_API_KEY: "app", DATABASE_URL: "db" }, "claude-code")
    expect(env).toEqual({ ANTHROPIC_API_KEY_: "app", DATABASE_URL: "db", [APP_ENV_REMAP_ENV]: "ANTHROPIC_API_KEY" })
  })

  it("leaves names this agent's CLI never reads untouched", () => {
    expect(hideHarnessEnvKeys({ ANTHROPIC_API_KEY: "app" }, "codex")).toEqual({ ANTHROPIC_API_KEY: "app" })
    expect(hideHarnessEnvKeys({ OPENAI_API_KEY: "app" }, "codex")).toEqual({
      OPENAI_API_KEY_: "app",
      [APP_ENV_REMAP_ENV]: "OPENAI_API_KEY",
    })
  })

  it("covers aliases and every provider key a multi-provider agent reads", () => {
    const env = hideHarnessEnvKeys({ GEMINI_API_KEY: "g", GOOGLE_API_KEY: "g2", ANTHROPIC_API_KEY: "a" }, "droid")
    expect(env).toEqual({
      GEMINI_API_KEY_: "g",
      GOOGLE_API_KEY_: "g2",
      ANTHROPIC_API_KEY_: "a",
      [APP_ENV_REMAP_ENV]: "GEMINI_API_KEY GOOGLE_API_KEY ANTHROPIC_API_KEY",
    })
  })

  it("keeps a NAME_ the user set themselves", () => {
    const env = hideHarnessEnvKeys({ OPENAI_API_KEY: "renamed", OPENAI_API_KEY_: "explicit" }, "codex")
    expect(env.OPENAI_API_KEY_).toBe("explicit")
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  it("adds nothing when no name collides", () => {
    expect(hideHarnessEnvKeys({ FOO: "1" }, "gemini")).toEqual({ FOO: "1" })
  })

  it("uses the env var name the SDK reads", () => {
    expect(COMMON_REMAP_ENV).toBe(APP_ENV_REMAP_ENV)
  })
})

describe("applyAppEnvHook", () => {
  const wants = { [APP_ENV_REMAP_ENV]: "ANTHROPIC_API_KEY" }

  it("does nothing when nothing was renamed", () => {
    const spec = { cmd: "claude", args: ["-p"], env: { A: "1" } }
    expect(applyAppEnvHook(spec, { A: "1" })).toBe(spec)
  })

  it("arms a plain CLI through its env", () => {
    const out = applyAppEnvHook({ cmd: "claude", args: ["-p"], env: { A: "1" } }, wants)
    expect(out.env).toEqual({
      A: "1",
      BASH_ENV: APP_ENV_HOOK_FILE,
      CLAUDE_ENV_FILE: APP_ENV_HOOK_FILE,
      [APP_ENV_ARMED_ENV]: "1",
    })
    expect(out.args).toEqual(["-p"])
  })

  it("arms a bash-wrapped CLI inside the script, never in the wrapper's env", () => {
    for (const flag of ["-c", "-lc"]) {
      const out = applyAppEnvHook({ cmd: "bash", args: [flag, "droid exec x"], env: { A: "1" } }, wants)
      expect(out.env).toEqual({ A: "1" })
      expect(out.args[0]).toBe(flag)
      expect(out.args[1]).toBe(
        `export BASH_ENV='${APP_ENV_HOOK_FILE}' CLAUDE_ENV_FILE='${APP_ENV_HOOK_FILE}' ${APP_ENV_ARMED_ENV}='1'\ndroid exec x`
      )
    }
  })
})

describe("APP_ENV_HOOK_SCRIPT", () => {
  const dir = mkdtempSync(join(tmpdir(), "app-env-hook-"))
  const hook = join(dir, "hook.sh")
  writeFileSync(hook, APP_ENV_HOOK_SCRIPT)
  const run = (env: Record<string, string>, script: string) =>
    execFileSync("sh", ["-c", `. '${hook.replace(/\\/g, "/")}'; ${script}`], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    }).trim()

  it("maps each listed NAME_ back to NAME when armed", () => {
    const env = { [APP_ENV_ARMED_ENV]: "1", [APP_ENV_REMAP_ENV]: "FOO BAR", FOO_: "app", FOO: "harness", BAR_: "with space" }
    expect(run(env, 'echo "$FOO|$BAR"')).toBe("app|with space")
  })

  it("is a no-op when not armed (the CLI process and its wrapper)", () => {
    expect(run({ [APP_ENV_REMAP_ENV]: "FOO", FOO_: "app", FOO: "harness" }, 'echo "$FOO"')).toBe("harness")
  })

  it("leaves NAME alone when NAME_ is absent", () => {
    expect(run({ [APP_ENV_ARMED_ENV]: "1", [APP_ENV_REMAP_ENV]: "FOO", FOO: "harness" }, 'echo "$FOO"')).toBe("harness")
  })

  it("skips malformed names and copies values verbatim", () => {
    const env = { [APP_ENV_ARMED_ENV]: "1", [APP_ENV_REMAP_ENV]: "1BAD x;touch_pwned FOO", FOO_: 'a"b$(echo no)`id`' }
    expect(run(env, 'printf "%s" "$FOO"')).toBe('a"b$(echo no)`id`')
  })
})
