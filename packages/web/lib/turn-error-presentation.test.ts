import { describe, expect, it } from "vitest"
import { persistedProviderFailure } from "./turn-error-presentation"
import type { Chat } from "./types"

function failed(reason = "ProviderHeaderTimeoutError: Provider response headers timed out after 300000ms"): Chat {
  return { status: "error", messages: [
    { id: "user", role: "user", content: "hello", timestamp: 1 },
    { id: "reply", role: "assistant", content: "", timestamp: 2, metadata: {
      turnFinalization: { state: "error", executionStopped: true, assistantMessageId: "reply", backgroundSessionId: "session", reason },
    } },
  ] } as Chat
}

describe("persisted provider failure presentation", () => {
  it.each([
    "400 invalid_request_error: The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    '{"error":{"message":"The model is not supported with this account","type":"invalid_request_error"}}',
  ])("explains unsupported models after restoring history: %s", reason => {
    expect(persistedProviderFailure(failed(reason))).toBe(
      "This model is not supported in this session. Choose another model before retrying.")
  })
  it("identifies a timeout without displaying raw logs", () => {
    const message = persistedProviderFailure(failed())
    expect(message).toContain("model provider did not respond in time")
    expect(message).not.toContain("300000")
  })
  it("offers a model change for a missing model", () => {
    expect(persistedProviderFailure(failed("ProviderModelNotFoundError: Model not found: private/model"))).toBe(
      "This model is no longer available. Choose another model before retrying.")
  })
  it("explains the known startup timeout only after the matching attempt is confirmed stopped", () => {
    const reason = "Agent startup timed out. Please send your prompt again."
    const chat = failed(reason)
    expect(persistedProviderFailure(chat)).toBe(reason)
    const launchError = "Could not start sandbox job (exit code 1): Permission denied"
    chat.messages[1].metadata!.launchError = launchError
    expect(persistedProviderFailure(chat)).toBe(launchError)
    chat.messages[1].metadata!.turnFinalization!.executionStopped = false
    expect(persistedProviderFailure(chat)).toBeUndefined()
  })
  it.each(["running", "creating", "ready", "disconnected"])("does not leak the previous error into %s", status => {
    expect(persistedProviderFailure({ ...failed(), status: status as Chat["status"] })).toBeUndefined()
  })
  it.each(["pendingSend", "stopPending", "backgroundSessionId", "activeAssistantMessageId"])("waits while %s is active", key => {
    expect(persistedProviderFailure({ ...failed(), [key]: true })).toBeUndefined()
  })
  it("ignores an old failed turn when a newer user message exists", () => {
    const chat = failed()
    chat.messages.push({ id: "new-user", role: "user", content: "new prompt", timestamp: 3 })
    expect(persistedProviderFailure(chat)).toBeUndefined()
  })
  it.each(["state", "executionStopped", "assistantMessageId", "backgroundSessionId", "reason"])("rejects an incomplete or mismatched marker: %s", key => {
    const chat = failed()
    const marker = chat.messages[1].metadata!.turnFinalization!
    Object.assign(marker, { [key]: key === "assistantMessageId" ? "different-reply" : undefined })
    expect(persistedProviderFailure(chat)).toBeUndefined()
  })
  it("shows other saved errors without the output a crash attaches", () => {
    const rateLimit = "429 Too Many Requests — wait a moment and retry"
    expect(persistedProviderFailure(failed(rateLimit))).toBe(rateLimit)
    expect(persistedProviderFailure(failed("Agent process exited without completing (crashed or killed)\n\nsecret execution details")))
      .toBe("Agent process exited without completing (crashed or killed)")
  })
  it.each([undefined, "error" as const])("reads the matching failure before the finalizer's error notice (%s)", messageType => {
    const chat = failed()
    chat.messages.push({ id: "reply:error", role: "assistant", content: "Agent stopped: private logs", timestamp: 3, isError: true, messageType })
    expect(persistedProviderFailure(chat)).toContain("model provider did not respond in time")
  })
  it.each(["different:error", "reply:error:error"])("does not search past an unrelated error notice: %s", id => {
    const chat = failed()
    chat.messages.push({ id, role: "assistant", content: "Agent stopped", timestamp: 3, isError: true })
    expect(persistedProviderFailure(chat)).toBeUndefined()
  })
  it("does not expose an earlier turn's failure when its late notice follows a newer turn", () => {
    const chat = failed()
    chat.messages.push(
      { id: "new-user", role: "user", content: "next prompt", timestamp: 3 },
      { id: "new-reply", role: "assistant", content: "", timestamp: 4 },
      { id: "reply:error", role: "assistant", content: "Agent stopped", timestamp: 5, isError: true },
    )
    expect(persistedProviderFailure(chat)).toBeUndefined()
  })
})
