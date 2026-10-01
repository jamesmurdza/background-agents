import { afterEach, describe, expect, it, vi } from "vitest"
import { applyRetryInPlace, sendMessageToApi } from "./chat-messages"
import type { Chat } from "@/lib/types"

describe("sendMessageToApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves what the limit dialog needs from a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        provider: "gemini",
        creditBalance: -1.5,
      }, { status: 429 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "gemini",
      model: "gemini-2.5-flash",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({
      ok: false,
      isDailyLimit: true,
      provider: "gemini",
      creditBalance: -1.5,
    })
  })

  it("ignores a non-numeric creditBalance rather than passing it through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        error: "DAILY_LIMIT_EXCEEDED",
        provider: "claude",
        creditBalance: "lots",
      }, { status: 429 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "claude",
      model: "claude-opus-5",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({ ok: false, isDailyLimit: true })
    expect((result as { creditBalance?: unknown }).creditBalance).toBeUndefined()
  })
})

describe("applyRetryInPlace", () => {
  function errorChat(): Chat {
    return {
      id: "chat-1",
      repo: "owner/repo",
      baseBranch: "main",
      branch: "fix/example",
      sandboxId: "sbx-1",
      sessionId: "ses-1",
      displayName: "Example",
      createdAt: 0,
      updatedAt: 0,
      status: "error",
      errorMessage: "Failed to authenticate: OAuth session expired and could not be refreshed",
      errorKind: undefined,
      messages: [
        { id: "user-1", role: "user", content: "hi", timestamp: 1 },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Error: Failed to authenticate: OAuth session expired and could not be refreshed",
          timestamp: 2,
          messageType: "error",
          isError: true,
          toolCalls: [{ tool: "bash", summary: "ls" }],
        },
      ],
    } as Chat
  }

  it("clears the chat's error state without touching message count or ids", () => {
    const chat = errorChat()
    const result = applyRetryInPlace(chat, "assistant-1")

    expect(result.status).toBe("running")
    expect(result.errorMessage).toBeUndefined()
    expect(result.errorKind).toBeUndefined()
    expect(result.messages).toHaveLength(2) // no new rows — this is the whole point
    expect(result.messages.map((m) => m.id)).toEqual(["user-1", "assistant-1"])
  })

  it("resets the failed assistant message's content/error flags, leaves the user message untouched", () => {
    const chat = errorChat()
    const result = applyRetryInPlace(chat, "assistant-1")

    const assistant = result.messages.find((m) => m.id === "assistant-1")
    expect(assistant?.content).toBe("")
    expect(assistant?.isError).toBe(false)
    expect(assistant?.messageType).toBeUndefined()
    expect(assistant?.toolCalls).toEqual([])

    const user = result.messages.find((m) => m.id === "user-1")
    expect(user?.content).toBe("hi")
  })

  it("goes to 'creating' instead of 'running' when there's no sandbox yet", () => {
    const chat = { ...errorChat(), sandboxId: null }
    expect(applyRetryInPlace(chat, "assistant-1").status).toBe("creating")
  })
})
