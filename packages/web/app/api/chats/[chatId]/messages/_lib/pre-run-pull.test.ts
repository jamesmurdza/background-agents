/**
 * Tests for runPreRunPull's skip/run gate.
 *
 * Regression coverage for the bug where a sandbox recreated after expiry could
 * silently restore its branch from a *stale* `baseBranch` tip (when the real
 * branch restore fetch/checkout failed — see createSandboxForChat's
 * `branchRestored` flag). The old gate (`!createdSandbox`) treated every
 * freshly created sandbox as already current, so that stale case never got a
 * chance to catch up before the agent started committing on top of it — the
 * turn's end-of-turn push then failed as a non-fast-forward rejection with no
 * indication of why. The gate must still run the pull when `createdSandbox` is
 * true but `branchRestored === false`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const autoPullBeforeRun = vi.fn()
vi.mock("@/lib/server/auto-pull", () => ({
  autoPullBeforeRun: (...args: unknown[]) => autoPullBeforeRun(...args),
}))

const createGitOperationMessage = vi.fn()
vi.mock("@/lib/db/git-messages", () => ({
  createGitOperationMessage: (...args: unknown[]) => createGitOperationMessage(...args),
}))

import { runPreRunPull } from "./pre-run-pull"

const baseParams = {
  sandbox: {} as never,
  repoPath: "/home/daytona/project",
  chat: { repo: "octocat/hello" } as never,
  chatId: "chat-1",
  branch: "agent/abc123",
  githubToken: "ghtoken",
}

beforeEach(() => {
  autoPullBeforeRun.mockReset().mockResolvedValue({ status: "up-to-date" })
  createGitOperationMessage.mockReset().mockResolvedValue(undefined)
})

describe("runPreRunPull — gate", () => {
  it("pulls when the sandbox was reused (not created this request)", async () => {
    await runPreRunPull({ ...baseParams, createdSandbox: false })
    expect(autoPullBeforeRun).toHaveBeenCalledOnce()
  })

  it("skips when a sandbox was freshly created with no restore attempted (first-time creation)", async () => {
    await runPreRunPull({ ...baseParams, createdSandbox: true, branchRestored: undefined })
    expect(autoPullBeforeRun).not.toHaveBeenCalled()
  })

  it("skips when a sandbox was created and the branch restore succeeded (already current)", async () => {
    await runPreRunPull({ ...baseParams, createdSandbox: true, branchRestored: true })
    expect(autoPullBeforeRun).not.toHaveBeenCalled()
  })

  it("still pulls when a sandbox was created but the branch restore fell back to a stale baseBranch tip", async () => {
    await runPreRunPull({ ...baseParams, createdSandbox: true, branchRestored: false })
    expect(autoPullBeforeRun).toHaveBeenCalledOnce()
  })

  it("catches the recreated sandbox up via a clean pull, surfacing a normal git-operation message", async () => {
    autoPullBeforeRun.mockResolvedValue({ status: "pulled", commits: 2 })

    const result = await runPreRunPull({ ...baseParams, createdSandbox: true, branchRestored: false })

    expect(result).toEqual({ pullConflictNote: "" })
    expect(createGitOperationMessage).toHaveBeenCalledWith(
      "chat-1",
      "Pulled 2 commits from agent/abc123.",
      false,
      undefined,
      "agent/abc123"
    )
  })

  it("hands a short note to the agent when a prior conflicted pull is still in progress", async () => {
    autoPullBeforeRun.mockResolvedValue({
      status: "conflict", alreadyInProgress: true, conflictedFiles: ["a.ts", "b.ts"],
    })

    const result = await runPreRunPull({ ...baseParams, createdSandbox: false })

    expect(result).toEqual({
      pullConflictNote: "A merge of origin/agent/abc123 is in progress with conflicts in: a.ts, b.ts. ",
    })
  })
})
