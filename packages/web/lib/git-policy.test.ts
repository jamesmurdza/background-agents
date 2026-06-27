import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  renderClaudeHook,
  renderCodexRules,
  renderOpenCodePermissions,
} from "@background-agents/agent-configuration/permissions"
import { DEFAULT_GIT_POLICY } from "./git-policy"

/**
 * Run the rendered Claude hook against a command and report whether it blocks.
 * The hook normally reads JSON from stdin via `jq`; we replace that with a
 * literal `COMMAND=` assignment so the test exercises the generated regex logic
 * without needing jq installed.
 */
function claudeBlocks(command: string): boolean {
  const hook = renderClaudeHook(DEFAULT_GIT_POLICY)
  const body = hook
    .replace("INPUT=$(cat)", "")
    .replace(
      `COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')`,
      ""
    )
  const script = `COMMAND='${command}'\n${body}`
  try {
    execFileSync("bash", ["-c", script], { stdio: "pipe" })
    return false // exit 0 → allowed
  } catch {
    return true // non-zero exit → blocked
  }
}

describe("Claude hook rendered from DEFAULT_GIT_POLICY", () => {
  const blocked = [
    "git push",
    "git push origin main",
    "git rebase main",
    "git commit --amend",
    "git commit -m wip --amend",
    "git reset --hard HEAD",
    "git reset HEAD~1 --hard",
    "git branch -d feature",
    "git branch -D feature",
    "git branch -m old new",
    "git checkout -b feature",
    "git switch -c feature",
    "git switch main",
    "git checkout main",
    "git checkout feature/x",
    "ls && git push",
  ]
  const allowed = [
    "git status",
    'git commit -m "a normal commit"',
    "git rebase --continue",
    "git rebase --abort",
    "git rebase --skip",
    "git checkout .",
    "git checkout -- file.txt",
    "git checkout HEAD",
    "git restore .",
    "git reset --soft HEAD~1",
    "git add . && git commit -m wip",
  ]

  it.each(blocked)("blocks %j", (cmd) => {
    expect(claudeBlocks(cmd)).toBe(true)
  })

  it.each(allowed)("allows %j", (cmd) => {
    expect(claudeBlocks(cmd)).toBe(false)
  })
})

describe("Codex rules rendered from DEFAULT_GIT_POLICY", () => {
  const rules = renderCodexRules(DEFAULT_GIT_POLICY)

  it.each([
    `pattern=["git", "commit", "--amend"]`,
    `pattern=["git", "rebase"]`,
    `pattern=["git", "reset", "--hard"]`,
    `pattern=["git", "push"]`,
    `pattern=["git", "branch", "-d"]`,
    `pattern=["git", "branch", "-D"]`,
    `pattern=["git", "branch", "-m"]`,
    `pattern=["git", "branch", "-M"]`,
    `pattern=["git", "checkout"]`,
    `pattern=["git", "switch"]`,
  ])("emits %s", (pattern) => {
    expect(rules).toContain(pattern)
  })

  it('forbids every rule', () => {
    expect(rules).not.toContain('decision="allow"')
  })
})

describe("OpenCode permissions rendered from DEFAULT_GIT_POLICY", () => {
  const perms = renderOpenCodePermissions(DEFAULT_GIT_POLICY)

  it("denies the policy commands", () => {
    expect(perms.bash["git push*"]).toBe("deny")
    expect(perms.bash["git checkout*"]).toBe("deny")
    expect(perms.bash["git switch*"]).toBe("deny")
    expect(perms.bash["git rebase*"]).toBe("deny")
    expect(perms.bash["git commit --amend*"]).toBe("deny")
    expect(perms.bash["git reset --hard*"]).toBe("deny")
    expect(perms.bash["git branch -d*"]).toBe("deny")
  })

  it("keeps the default-allow and baseline enablement permissions", () => {
    expect(perms.bash["*"]).toBe("allow")
    expect(perms.edit["*"]).toBe("allow")
    expect(perms.webfetch["*"]).toBe("allow")
    expect(perms.external_directory["*"]).toBe("allow")
  })
})
