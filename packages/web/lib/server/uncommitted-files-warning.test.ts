import { beforeEach, describe, expect, it, vi } from "vitest"

const { inspect, updateMany } = vi.hoisted(() => ({
  inspect: vi.fn(),
  updateMany: vi.fn(),
}))
vi.mock("@/lib/git/uncommitted-files", () => ({ inspectUncommittedFiles: inspect }))
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
  updateMany.mockReset().mockResolvedValue({ count: 1 })
})

describe("refreshUncommittedFilesWarning", () => {
  it("sets and clears one chat flag, scoped to the current turn", async () => {
    inspect.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await refreshUncommittedFilesWarning(params)).toBe(true)
    expect(await refreshUncommittedFilesWarning(params)).toBe(false)
    expect(updateMany.mock.calls.map(([arg]) => arg)).toEqual([
      { where: { id: "chat-1", backgroundSessionId: "turn-1" }, data: { hasUncommittedFiles: true } },
      { where: { id: "chat-1", backgroundSessionId: "turn-1" }, data: { hasUncommittedFiles: false } },
    ])
  })

  it("keeps the prior warning when Git inspection fails", async () => {
    inspect.mockResolvedValue(null)
    expect(await refreshUncommittedFilesWarning(params)).toBeUndefined()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("does not return stale state after another finalizer released the turn", async () => {
    inspect.mockResolvedValue(true)
    updateMany.mockResolvedValue({ count: 0 })
    expect(await refreshUncommittedFilesWarning(params)).toBeUndefined()
  })

  it("two concurrent finalizers write the same state without appending duplicate warnings", async () => {
    inspect.mockResolvedValue(true)
    expect(await Promise.all([
      refreshUncommittedFilesWarning(params),
      refreshUncommittedFilesWarning(params),
    ])).toEqual([true, true])
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany.mock.calls.every(([arg]) => arg.data.hasUncommittedFiles === true)).toBe(true)
  })
})
