import { afterEach, describe, expect, it, vi } from "vitest"
import { applyOptimisticSend, applySendSuccess, removeOptimisticMessages, sendMessageToApi } from "./chat-messages"
import { SECRETS_UNAVAILABLE_CODE } from "./secrets-failure"
import type { Chat, Message } from "./types"

describe("optimistic turn identity", () => {
  it("tracks the new assistant through send and clears it when the send fails", () => {
    const chat = { id: "chat-1", messages: [], status: "ready", sandboxId: "sandbox-1" } as unknown as Chat
    const user = { id: "user-1", role: "user", content: "say 4" } as Message
    const assistant = { id: "assistant-1", role: "assistant", content: "" } as Message
    const sending = applyOptimisticSend(chat, user, assistant, Date.now())
    expect(sending.activeAssistantMessageId).toBe(assistant.id)
    expect(removeOptimisticMessages(sending, [user.id, assistant.id]).activeAssistantMessageId).toBeUndefined()
  })
})

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

  it("flags a send refused because its secrets couldn't be set up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "Couldn't set up the secure key proxy", code: SECRETS_UNAVAILABLE_CODE }, { status: 503 })
    ))

    const result = await sendMessageToApi("chat-1", {
      message: "Continue",
      agent: "opencode",
      model: "opencode/big-pickle",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result).toMatchObject({ ok: false, isSecretsUnavailable: true, error: "Couldn't set up the secure key proxy" })
  })

  it("resets the secrets failure count once a send succeeds", () => {
    const chat = { id: "chat-1", messages: [], status: "running", secretsFailureCount: 2 } as unknown as Chat
    const next = applySendSuccess(chat, {
      sandboxId: "sb-1", branch: null, previewUrlPattern: null, backgroundSessionId: "bg-1", uploadedFiles: [],
    }, "opencode", "opencode/big-pickle", "user-1")
    expect(next.secretsFailureCount).toBeUndefined()
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
