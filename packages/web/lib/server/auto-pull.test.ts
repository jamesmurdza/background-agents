/**
 * Unit tests for autoPullBeforeRun.
 *
 * The git plumbing is driven entirely through sandbox.process.executeCommand, so
 * we mock it by matching commands and returning canned results.
 */
import { describe, it, expect } from "vitest"
import { autoPullBeforeRun } from "./auto-pull"
import type { ExecuteResult, SandboxLike } from "@background-agents/daytona-git"

type Responder = (cmd: string) => ExecuteResult

function makeSandbox(responder: Responder): {
  sandbox: SandboxLike
  commands: string[]
} {
  const commands: string[] = []
  const sandbox: SandboxLike = {
    process: {
      async executeCommand(command: string): Promise<ExecuteResult> {
        commands.push(command)
        return responder(command)
      },
    },
  }
  return { sandbox, commands }
}

const ok = (result = ""): ExecuteResult => ({ result, exitCode: 0 })

const REPO = "/home/daytona/project"
const BRANCH = "agent/abc123"
const TOKEN = "ghs_token"

/** A responder where `git rev-parse --short HEAD` advances after the merge. */
function ffResponder(opts: {
  behind: string
  dirty?: string
  mergeExit?: number
  mergeOutput?: string
  conflicts?: string
  /** HEAD before and after the merge (defaults: advances). */
  headSeq?: string[]
}): Responder {
  const heads = [...(opts.headSeq ?? ["old1234", "new5678"])]
  // Conflicts / MERGE_HEAD only appear *after* the merge has run, so the
  // start-of-pull "already in conflict" guard sees a clean tree first.
  let merged = false
  return (cmd) => {
    if (cmd.includes("rev-list")) return ok(opts.behind)
    if (cmd.includes("rev-parse --short HEAD")) return ok(heads.length > 1 ? heads.shift()! : heads[0])
    if (cmd.includes("git status --porcelain")) return ok(opts.dirty ?? "")
    if (cmd.includes("MERGE_HEAD")) return ok(merged && opts.conflicts ? "yes" : "no")
    if (cmd.includes("--diff-filter=U")) return ok(merged ? (opts.conflicts ?? "") : "")
    if (cmd.includes("git merge")) {
      merged = true
      return { result: opts.mergeOutput ?? "", exitCode: opts.mergeExit ?? 0 }
    }
    return ok()
  }
}

describe("autoPullBeforeRun", () => {
  it("returns up-to-date when the branch is not behind origin", async () => {
    const { sandbox, commands } = makeSandbox((cmd) => {
      if (cmd.includes("rev-list")) return ok("0\t2") // behind 0, ahead 2
      return ok()
    })

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({ status: "up-to-date" })
    expect(commands.some((c) => c.includes("git merge"))).toBe(false)
  })

  it("merges cleanly (HEAD advances) and reports the number of pulled commits", async () => {
    const { sandbox, commands } = makeSandbox(ffResponder({ behind: "3\t0" }))

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({ status: "pulled", commits: 3 })
    // Plain merge (no --autostash) on a clean tree; no WIP commit needed.
    expect(commands.some((c) => c.includes("git merge --no-edit origin/"))).toBe(true)
    expect(commands.some((c) => c.includes("git merge --no-edit --autostash"))).toBe(false)
    expect(commands.some((c) => c.includes("git add -A && git commit"))).toBe(false)
    // Installs the pre-commit hook that blocks committing conflict markers.
    expect(commands.some((c) => c.includes(".git/hooks/pre-commit") && c.includes("git diff --cached --check"))).toBe(true)
  })

  it("commits the WIP before merging when the working tree is dirty", async () => {
    const { sandbox, commands } = makeSandbox(
      ffResponder({ behind: "1\t0", dirty: " M src/main.py" })
    )

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({ status: "pulled", commits: 1 })
    // WIP is committed first so the pull is a real, abortable merge.
    expect(commands.some((c) => c.includes("git add -A && git commit"))).toBe(true)
    expect(commands.some((c) => c.includes("git merge --no-edit origin/"))).toBe(true)
    expect(commands.some((c) => c.includes("--autostash"))).toBe(false)
  })

  it("reports error (not pulled) when the merge fails and HEAD does not move", async () => {
    // A merge that fails without a content conflict and leaves HEAD unchanged.
    const { sandbox } = makeSandbox(
      ffResponder({
        behind: "2\t0",
        mergeExit: 1,
        mergeOutput: "fatal: merge failed",
        headSeq: ["old1234", "old1234"], // HEAD does not advance
      })
    )

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({
      status: "error",
      message: "fatal: merge failed",
    })
  })

  it("leaves the merge in progress and flags a fresh conflict (not already in progress)", async () => {
    const { sandbox, commands } = makeSandbox(
      ffResponder({ behind: "1\t1", conflicts: "src/a.ts\nsrc/b.ts" })
    )

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({
      status: "conflict",
      conflictedFiles: ["src/a.ts", "src/b.ts"],
      alreadyInProgress: false,
    })
    expect(commands.some((c) => c.includes("git merge --abort"))).toBe(false)
  })

  it("reports an already-in-progress merge without fetching or re-merging", async () => {
    // A prior conflicted pull left a merge in progress; the user sent a message
    // to have the agent resolve it.
    const { sandbox, commands } = makeSandbox((cmd) => {
      if (cmd.includes("MERGE_HEAD")) return ok("yes")
      if (cmd.includes("--diff-filter=U")) return ok("src/a.ts")
      return ok()
    })

    const res = await autoPullBeforeRun(sandbox, REPO, BRANCH, TOKEN)

    expect(res).toEqual({
      status: "conflict",
      conflictedFiles: ["src/a.ts"],
      alreadyInProgress: true,
    })
    expect(commands.some((c) => c.includes("fetch"))).toBe(false)
    expect(commands.some((c) => c.includes("git merge --no-edit"))).toBe(false)
  })
})
