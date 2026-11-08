import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { inspectGitWorkingTree } from "./uncommitted-files"

function makeSandbox(root: string) {
  return {
    process: {
      executeCommand: async (command: string) => {
        const res = spawnSync("/bin/sh", ["-c", command], { cwd: root, encoding: "utf8" })
        return { result: res.stdout + res.stderr, exitCode: res.status ?? 1 }
      },
    },
  }
}

function repoFixture() {
  const root = mkdtempSync("/private/tmp/backgrounder-uncommitted-test-")
  execFileSync("git", ["init", "--initial-branch=main", root], { stdio: "pipe" })
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe", env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    } })
  const write = (path: string, content = "test\n") => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  write(".gitignore", "ignored/\n")
  git("add", ".gitignore")
  git("commit", "-m", "baseline")
  return { root, git, write, sandbox: makeSandbox(root) }
}

/** Just the uncommitted count, for assertions that don't care about hasCommits. */
async function files(sandbox: ReturnType<typeof makeSandbox>, root: string) {
  return (await inspectGitWorkingTree(sandbox, root))?.uncommittedFilesCount
}

describe("inspectGitWorkingTree", () => {
  it("distinguishes clean, untracked, staged, and ignored files", async () => {
    const f = repoFixture()
    expect(await files(f.sandbox, f.root)).toBe(0)
    f.write("ignored/output.log")
    expect(await files(f.sandbox, f.root)).toBe(0)
    f.write("src/new-page.tsx")
    expect(await files(f.sandbox, f.root)).toBe(1)
    f.git("add", "src/new-page.tsx")
    expect(await files(f.sandbox, f.root)).toBe(1)
    f.git("commit", "-m", "add new page")
    expect(await files(f.sandbox, f.root)).toBe(0)
  })

  it("finds nested files even when Git is configured to hide untracked files", async () => {
    const f = repoFixture()
    f.git("config", "status.showUntrackedFiles", "no")
    f.write("nested/file with spaces.ts")
    f.write("nested/line\nbreak.ts")
    expect(await files(f.sandbox, f.root)).toBe(2)
  })

  it("counts edited and deleted files that were committed before", async () => {
    const f = repoFixture()
    f.write("src/toast.tsx", "old\n")
    f.write("src/old.ts")
    f.git("add", ".")
    f.git("commit", "-m", "baseline files")
    f.write("src/toast.tsx", "new\n")
    f.git("rm", "-q", "src/old.ts")
    expect(await files(f.sandbox, f.root)).toBe(2)
    f.git("commit", "-am", "edit and delete")
    expect(await files(f.sandbox, f.root)).toBe(0)
  })

  it("warns when a successful push leaves a new file outside the remote commit", async () => {
    const f = repoFixture()
    const remote = `${f.root}.git`
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote])
    f.git("remote", "add", "origin", remote)

    f.write("tracked.txt", "pushed\n")
    f.git("add", "tracked.txt")
    f.git("commit", "-m", "tracked change")
    f.write("not-pushed.txt", "missing from GitHub\n")
    f.git("push", "-u", "origin", "main")

    expect(f.git("--git-dir", remote, "show", "main:tracked.txt")).toBe("pushed\n")
    expect(() => f.git("--git-dir", remote, "show", "main:not-pushed.txt")).toThrow()
    expect(await files(f.sandbox, f.root)).toBe(1)

    f.git("add", "not-pushed.txt")
    f.git("commit", "-m", "include missing file")
    f.git("push", "origin", "main")
    expect(f.git("--git-dir", remote, "show", "main:not-pushed.txt")).toBe("missing from GitHub\n")
    expect(await files(f.sandbox, f.root)).toBe(0)
  })

  it("is false for a repo with no commits beyond the scaffold's own baseline one", async () => {
    const root = mkdtempSync("/private/tmp/backgrounder-uncommitted-test-")
    execFileSync("git", ["init", "--initial-branch=main", root], { stdio: "pipe" })
    const sandbox = makeSandbox(root)
    expect(await inspectGitWorkingTree(sandbox, root)).toEqual({ uncommittedFilesCount: 0, hasCommits: false })

    // Every sandbox repo starts from a template with one commit already
    // made (by the scaffolding tool, not the user) — repoFixture's baseline
    // commit mirrors that. hasCommits must stay false here: "HEAD exists"
    // alone can't be the signal, since that's true immediately for every
    // chat regardless of whether the agent has done anything.
    const f = repoFixture()
    expect(await inspectGitWorkingTree(f.sandbox, f.root)).toEqual({ uncommittedFilesCount: 0, hasCommits: false })
    f.write("src/new-page.tsx")
    expect(await inspectGitWorkingTree(f.sandbox, f.root)).toEqual({ uncommittedFilesCount: 1, hasCommits: false })
    f.git("add", "src/new-page.tsx")
    f.git("commit", "-m", "add new page")
    expect(await inspectGitWorkingTree(f.sandbox, f.root)).toEqual({ uncommittedFilesCount: 0, hasCommits: true })
  })

  it("returns unknown when Git fails", async () => {
    const f = repoFixture()
    f.sandbox.process.executeCommand = async () => ({ result: "Git failed", exitCode: 1 })
    expect(await inspectGitWorkingTree(f.sandbox, f.root)).toBeNull()
  })

  it("does not block turn completion if the sandbox stalls", async () => {
    vi.useFakeTimers()
    try {
      const f = repoFixture()
      f.sandbox.process.executeCommand = async () => new Promise(() => {})
      const inspection = inspectGitWorkingTree(f.sandbox, f.root)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await inspection).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
