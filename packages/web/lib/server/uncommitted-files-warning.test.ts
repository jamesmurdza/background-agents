import { beforeEach, describe, expect, it, vi } from "vitest"

const { inspect, hasCommitsCheck, updateMany } = vi.hoisted(() => ({
  inspect: vi.fn(),
  hasCommitsCheck: vi.fn(),
  updateMany: vi.fn(),
}))
vi.mock("@/lib/git/uncommitted-files", () => ({
  inspectUncommittedFiles: inspect,
  hasAnyCommits: hasCommitsCheck,
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { chat: { updateMany } } }))

import { refreshUncommittedFilesWarning } from "./uncommitted-files-warning"

const params = {
  sandbox: {} as Parameters<typeof refreshUncommittedFilesWarning>[0]["sandbox"],
  repoPath: "/sandbox/project",
  chatId: "chat-1",
  backgroundSessionId: "turn-1",
}

beforeEach(() => {
  inspect.mockReset()
  hasCommitsCheck.mockReset().mockResolvedValue(true)
  updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("refreshUncommittedFilesWarning", () => {
  it("sets and clears one chat count, scoped to the current turn", async () => {
    inspect.mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    expect(await refreshUncommittedFilesWarning(params)).toEqual({ uncommittedFilesCount: 2, hasCommits: true })
    expect(await refreshUncommittedFilesWarning(params)).toEqual({ uncommittedFilesCount: 0, hasCommits: true })
    expect(updateMany.mock.calls.map(([arg]) => arg)).toEqual([
      { where: { id: "chat-1", backgroundSessionId: "turn-1" }, data: { uncommittedFilesCount: 2, hasCommits: true } },
      { where: { id: "chat-1", backgroundSessionId: "turn-1" }, data: { uncommittedFilesCount: 0, hasCommits: true } },
    ])
  })

  it("keeps the prior warning when Git inspection fails", async () => {
    inspect.mockResolvedValue(null)
    expect(await refreshUncommittedFilesWarning(params)).toBeUndefined()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("keeps the prior warning when the commit check fails, even if the status check succeeds", async () => {
    inspect.mockResolvedValue(2)
    hasCommitsCheck.mockResolvedValue(null)
    expect(await refreshUncommittedFilesWarning(params)).toBeUndefined()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("does not return stale state after another finalizer released the turn", async () => {
    inspect.mockResolvedValue(2)
    updateMany.mockResolvedValue({ count: 0 })
    expect(await refreshUncommittedFilesWarning(params)).toBeUndefined()
  })

  it("two concurrent finalizers write the same state without appending duplicate warnings", async () => {
    inspect.mockResolvedValue(2)
    expect(await Promise.all([
      refreshUncommittedFilesWarning(params),
      refreshUncommittedFilesWarning(params),
    ])).toEqual([
      { uncommittedFilesCount: 2, hasCommits: true },
      { uncommittedFilesCount: 2, hasCommits: true },
    ])
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany.mock.calls.every(([arg]) => arg.data.uncommittedFilesCount === 2)).toBe(true)
  })
})
