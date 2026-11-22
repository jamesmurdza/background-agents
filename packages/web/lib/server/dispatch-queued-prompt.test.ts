import { beforeEach, describe, expect, it, vi } from "vitest"
import { SECRETS_UNAVAILABLE_CODE, TURN_SECRETS_UNAVAILABLE_MESSAGE } from "@/lib/secrets-failure"
import { dispatchQueuedPrompt } from "./dispatch-queued-prompt"

const mocks = vi.hoisted(() => ({ claim: vi.fn(), send: vi.fn(), release: vi.fn() }))
vi.mock("@/app/api/chats/[chatId]/messages/_lib/send-turn", () => ({ sendChatTurn: mocks.send }))
vi.mock("@/lib/server/prompt-queue", () => ({ claimNextPrompt: mocks.claim, releaseFailedPrompt: mocks.release }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.claim.mockResolvedValue({
    id: "queued-1", content: "Run after the current turn", agent: "codex", model: "test-model",
    userMessageId: "user-1", assistantMessageId: "assistant-1",
  })
})

describe("queued prompt startup errors", () => {
  it.each([
    { status: 503, code: SECRETS_UNAVAILABLE_CODE, error: "Upstream details", reason: TURN_SECRETS_UNAVAILABLE_MESSAGE },
    { status: 503, code: undefined, error: "Upstream details", reason: "Couldn't start queued prompt (HTTP 503)" },
    { status: 400, code: undefined, error: "Model unavailable", reason: "Model unavailable" },
  ])("pauses the claimed prompt and stores the safe message for HTTP $status ($code)", async ({ status, code, error, reason }) => {
    mocks.send.mockResolvedValue(Response.json({ code, error }, { status }))

    await expect(dispatchQueuedPrompt("chat-1", "owner-1")).resolves.toBe("paused")
    expect(mocks.release.mock.calls).toEqual([["queued-1", reason]])
  })
})
