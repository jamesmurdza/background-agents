/**
 * Regression test for ensureSandboxRunning's reuse-vs-recreate decision.
 *
 * Bug: the reuse path caught *any* error from `daytona.get`/`ensureSandboxStarted`
 * and treated it as proof the sandbox was deleted, falling through to create a
 * brand new one. During a transient Daytona outage (502/500/timeout), this
 * silently abandoned live sandboxes and spun up fresh ones underneath chats —
 * only a genuine 404 proves deletion (mirrors `getSandboxOrExpired` in
 * lib/sandbox-lifecycle.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const chatUpdate = vi.fn()
vi.mock("@/lib/db/prisma", () => ({
  prisma: { chat: { update: (args: unknown) => chatUpdate(args) } },
}))

import { ensureSandboxRunning } from "./sandbox"

function chat(overrides: Partial<{ sandboxId: string | null; branch: string | null }> = {}) {
  return {
    id: "chat-1",
    repo: "octocat/hello",
    baseBranch: "main",
    branch: overrides.branch ?? null,
    sandboxId: overrides.sandboxId ?? null,
    previewUrlPattern: null,
  }
}

describe("ensureSandboxRunning — reuse vs recreate on daytona.get failure", () => {
  beforeEach(() => {
    chatUpdate.mockReset().mockResolvedValue(undefined)
  })

  it("rethrows a transient Daytona error instead of treating the sandbox as deleted", async () => {
    const transient = Object.assign(new Error("Bad Gateway"), { statusCode: 502 })
    const daytonaGet = vi.fn().mockRejectedValue(transient)
    const daytona = { get: daytonaGet } as never

    await expect(
      ensureSandboxRunning({
        daytona,
        chat: chat({ sandboxId: "old-sbx", branch: "agent/work" }),
        userId: "user-1",
        githubToken: "tok",
      })
    ).rejects.toBe(transient)

    // Must not have fallen through to the "create a fresh sandbox" path,
    // which would have updated the chat row.
    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it("rethrows an error with no statusCode at all (e.g. a network timeout)", async () => {
    const timeout = new Error("timeout of 30000ms exceeded")
    const daytonaGet = vi.fn().mockRejectedValue(timeout)
    const daytona = { get: daytonaGet } as never

    await expect(
      ensureSandboxRunning({
        daytona,
        chat: chat({ sandboxId: "old-sbx", branch: "agent/work" }),
        userId: "user-1",
        githubToken: "tok",
      })
    ).rejects.toBe(timeout)

    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it("falls through to recreate only on a genuine 404", async () => {
    const notFound = Object.assign(new Error("not found"), { statusCode: 404 })
    const daytonaGet = vi.fn().mockRejectedValue(notFound)
    const daytona = { get: daytonaGet } as never

    // No githubToken to re-clone with, so this hits the one unrecoverable
    // branch past the reuse attempt — which confirms the 404 *was* treated
    // as deletion and the code fell through, rather than rethrowing.
    const result = await ensureSandboxRunning({
      daytona,
      chat: chat({ sandboxId: "old-sbx", branch: "agent/work" }),
      userId: "user-1",
      githubToken: null,
    })

    expect(result).toBeNull()
    expect(chatUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "error", sandboxId: null }) })
    )
  })
})
