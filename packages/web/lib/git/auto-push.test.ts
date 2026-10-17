import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the prisma singleton and the app-level git helpers so autoPushChat can
// be exercised without a DB or a real sandbox. `vi.hoisted` lets the factory
// (hoisted above imports) see the mocks.
const {
  push,
  getGitHubToken,
  activityLogCreate,
  isInConflictState,
  getUserPushOptions,
  createPushFailedMessage,
  clearPushFailureMessages,
} = vi.hoisted(() => ({
  push: vi.fn(),
  getGitHubToken: vi.fn(),
  activityLogCreate: vi.fn(),
  isInConflictState: vi.fn(),
  getUserPushOptions: vi.fn(),
  createPushFailedMessage: vi.fn(),
  clearPushFailureMessages: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { activityLog: { create: activityLogCreate } },
}))
vi.mock("@/lib/github/oauth-token", () => ({ getGitHubToken }))
vi.mock("@/lib/git/sandbox-git-ops", () => ({ isInConflictState }))
vi.mock("@/lib/git/push-options", () => ({ getUserPushOptions }))
vi.mock("@/lib/db/git-messages", () => ({ createPushFailedMessage, clearPushFailureMessages }))
// Keep the real error classes/classifiers (isRetryablePushError depends on
// them); only the sandbox-facing push() call is faked.
vi.mock("@background-agents/sandbox-git", async () => {
  const actual = await vi.importActual<typeof import("@background-agents/sandbox-git")>(
    "@background-agents/sandbox-git"
  )
  return { ...actual, createSandboxGit: () => ({ push }) }
})

import { autoPushChat } from "./auto-push"
import { GitAuthError, GitError } from "@background-agents/sandbox-git"

const sandbox = {
  process: { executeCommand: vi.fn() },
} as unknown as Parameters<typeof autoPushChat>[0]["sandbox"]

const baseParams = {
  sandbox,
  repoPath: "/home/daytona/project",
  chatId: "chat-1",
  userId: "user-1",
  branch: "feature",
}

beforeEach(() => {
  push.mockReset()
  getGitHubToken.mockReset().mockResolvedValue("tok")
  activityLogCreate.mockReset().mockResolvedValue({})
  isInConflictState.mockReset().mockResolvedValue(false)
  getUserPushOptions.mockReset().mockResolvedValue({ noVerify: true })
  createPushFailedMessage.mockReset()
  clearPushFailureMessages.mockReset()
  ;(sandbox.process.executeCommand as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockResolvedValue({ result: "1", exitCode: 0 })
})

describe("autoPushChat retry", () => {
  it("retries once on a transient failure and succeeds", async () => {
    push
      .mockRejectedValueOnce(new GitError("network blip", "git push", 1, "unable to access repo"))
      .mockResolvedValueOnce({ updated: true, newBranch: false, range: "a..b", output: "" })

    const result = await autoPushChat(baseParams)

    expect(push).toHaveBeenCalledTimes(2)
    expect(createPushFailedMessage).not.toHaveBeenCalled()
    expect(activityLogCreate).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ branch: "feature" }))
  })

  it("records one failure message and one git_push_failed event when both attempts fail transiently", async () => {
    push
      .mockRejectedValueOnce(new GitError("blip 1", "git push", 1, "unable to access repo"))
      .mockRejectedValueOnce(new GitError("blip 2", "git push", 1, "connection timed out"))

    const result = await autoPushChat(baseParams)

    expect(push).toHaveBeenCalledTimes(2)
    expect(createPushFailedMessage).toHaveBeenCalledTimes(1)
    expect(createPushFailedMessage).toHaveBeenCalledWith("chat-1", "blip 2")
    expect(activityLogCreate).toHaveBeenCalledTimes(1)
    expect(activityLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "git_push_failed",
        metadata: expect.objectContaining({ chatId: "chat-1", branch: "feature", message: "blip 2" }),
      }),
    })
    expect(result).toBeNull()
  })

  it("does not retry an auth failure, but still logs it once", async () => {
    push.mockRejectedValueOnce(new GitAuthError("git push", "authentication failed"))

    const result = await autoPushChat(baseParams)

    expect(push).toHaveBeenCalledTimes(1)
    expect(createPushFailedMessage).toHaveBeenCalledTimes(1)
    expect(activityLogCreate).toHaveBeenCalledTimes(1)
    expect(activityLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "git_push_failed" }),
    })
    expect(result).toBeNull()
  })

  it("does not retry a non-fast-forward rejection, but still logs it once", async () => {
    push.mockRejectedValueOnce(
      new GitError(
        "rejected",
        "git push",
        1,
        "! [rejected] feature -> feature (non-fast-forward)"
      )
    )

    const result = await autoPushChat(baseParams)

    expect(push).toHaveBeenCalledTimes(1)
    expect(createPushFailedMessage).toHaveBeenCalledTimes(1)
    expect(activityLogCreate).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })
})
