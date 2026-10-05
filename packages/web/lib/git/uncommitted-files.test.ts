import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"
import { inspectUncommittedFiles } from "./uncommitted-files"

function repoFixture() {
  // Use the OS temp dir rather than a hardcoded macOS path (`/private/tmp`),
  // which doesn't exist on Linux and silently never ran this suite in CI.
  const root = mkdtempSync(join(tmpdir(), "backgrounder-uncommitted-test-"))
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

  const sandbox = {
    process: {
      executeCommand: async (command: string) => {
        const res = spawnSync("/bin/sh", ["-c", command], { cwd: root, encoding: "utf8" })
        return { result: res.stdout + res.stderr, exitCode: res.status ?? 1 }
      },
    },
  }
  return { root, git, write, sandbox }
}

describe("inspectUncommittedFiles", () => {
  it("distinguishes clean, untracked, staged, and ignored files", async () => {
    const f = repoFixture()
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(0)
    f.write("ignored/output.log")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(0)
    f.write("src/new-page.tsx")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(1)
    f.git("add", "src/new-page.tsx")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(1)
    f.git("commit", "-m", "add new page")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(0)
  })

  it("finds nested files even when Git is configured to hide untracked files", async () => {
    const f = repoFixture()
    f.git("config", "status.showUntrackedFiles", "no")
    f.write("nested/file with spaces.ts")
    f.write("nested/line\nbreak.ts")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(2)
  })

  it("does not confuse a tracked modification with a newly added file", async () => {
    const f = repoFixture()
    f.write(".gitignore", "ignored/\nother/\n")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(0)
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
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(1)

    f.git("add", "not-pushed.txt")
    f.git("commit", "-m", "include missing file")
    f.git("push", "origin", "main")
    expect(f.git("--git-dir", remote, "show", "main:not-pushed.txt")).toBe("missing from GitHub\n")
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBe(0)
  })

  it("returns unknown when Git status fails", async () => {
    const f = repoFixture()
    f.sandbox.process.executeCommand = async () => ({ result: "Git failed", exitCode: 1 })
    expect(await inspectUncommittedFiles(f.sandbox, f.root)).toBeNull()
  })

  it("does not block turn completion if the sandbox stalls", async () => {
    vi.useFakeTimers()
    try {
      const f = repoFixture()
      f.sandbox.process.executeCommand = async () => new Promise(() => {})
      const inspection = inspectUncommittedFiles(f.sandbox, f.root)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await inspection).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
