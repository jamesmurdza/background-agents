import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applySendSuccess,
  applySetupHeld,
  sendMessageToApi,
  type SendMessageSettingUp,
} from "./chat-messages"
import type { Chat } from "./types"

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

// -----------------------------------------------------------------------------
// The held-turn ("setting_up") response
// -----------------------------------------------------------------------------

const HELD: SendMessageSettingUp = {
  status: "setting_up",
  sandboxId: "sbx_1",
  branch: "agent/fix-build",
  previewUrlPattern: "https://{{PORT}}-sbx_1.example.dev",
  uploadedFiles: [],
}

function chatMidSend(): Chat {
  return {
    id: "chat_1",
    repo: "acme/app",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    agent: "claude-code",
    model: "sonnet",
    planModeEnabled: false,
    environmentId: null,
    displayName: null,
    shareId: null,
    status: "creating",
    archived: false,
    pinned: false,
    needsSync: false,
    createdAt: 1,
    updatedAt: 1,
    lastActiveAt: 1,
    messageCount: 2,
    scriptUpdateNotice: null,
    messages: [
      { id: "user-1", role: "user", content: "fix the build", timestamp: 1 },
      { id: "assistant-1", role: "assistant", content: "", timestamp: 2, toolCalls: [], contentBlocks: [] },
    ],
  } as unknown as Chat
}

describe("sendMessageToApi on a held turn", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the setting_up variant, not something applySendSuccess can be handed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(HELD)))

    const result = await sendMessageToApi("chat_1", {
      message: "fix the build",
      agent: "claude-code",
      model: "sonnet",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.status).toBe("setting_up")
    // The whole point of the discriminant: nothing here can be read as a
    // started turn, which is what used to throw inside the cache updater.
    expect("backgroundSessionId" in result.data).toBe(false)
  })

  it("treats a body with no status as a started turn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        sandboxId: "sbx_1",
        branch: null,
        previewUrlPattern: null,
        backgroundSessionId: "bg_1",
        uploadedFiles: [],
      })
    ))

    const result = await sendMessageToApi("chat_1", {
      message: "hi",
      agent: "claude-code",
      model: "sonnet",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.status).toBe("started")
  })
})

describe("applySetupHeld", () => {
  it("parks the chat in setting_up with the sandbox already applied", () => {
    const next = applySetupHeld(chatMidSend(), HELD, "claude-code", "sonnet", "user-1", "assistant-1")

    expect(next.status).toBe("setting_up")
    expect(next.sandboxId).toBe("sbx_1")
    expect(next.branch).toBe("agent/fix-build")
    expect(next.previewUrlPattern).toBe("https://{{PORT}}-sbx_1.example.dev")
    // No session exists yet; nothing may start streaming off this.
    expect(next.backgroundSessionId).toBeUndefined()
  })

  it("drops the optimistic assistant placeholder and keeps the user message", () => {
    const next = applySetupHeld(chatMidSend(), HELD, "claude-code", "sonnet", "user-1", "assistant-1")

    // The server persists no assistant row for a held turn and mints a fresh
    // id when it dispatches, so a kept placeholder would be an empty bubble
    // now and a duplicate once the real reply arrives.
    expect(next.messages.map((m) => m.id)).toEqual(["user-1"])
  })

  it("stamps uploaded files on the user message", () => {
    const next = applySetupHeld(
      chatMidSend(),
      { ...HELD, uploadedFiles: ["/uploads/a.png"] },
      "claude-code",
      "sonnet",
      "user-1",
      "assistant-1"
    )

    expect(next.messages.find((m) => m.id === "user-1")?.uploadedFiles).toEqual(["/uploads/a.png"])
  })

  it("does not go through applySendSuccess, which reads fields a held turn has none of", () => {
    // Regression guard for the bug this variant exists to fix: the held body
    // has no uploadedFiles guarantee shared with a started turn and no
    // session, and applySendSuccess used to be handed it anyway.
    const missingFields = { status: "setting_up" } as unknown as Parameters<typeof applySendSuccess>[1]
    expect(() =>
      applySendSuccess(chatMidSend(), missingFields, "claude-code", "sonnet", "user-1")
    ).toThrow(TypeError)
  })
})
