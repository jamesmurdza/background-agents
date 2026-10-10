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
  it("identifies a timeout without displaying raw logs", () => {
    const message = persistedProviderFailure(failed())
    expect(message).toContain("model provider did not respond in time")
    expect(message).not.toContain("300000")
  })
  it("offers a model change for a missing model", () => {
    expect(persistedProviderFailure(failed("ProviderModelNotFoundError: Model not found: private/model"))).toBe(
      "This model is no longer available. Choose another model before retrying.")
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
  it("does not turn arbitrary logs into a UI error", () => {
    expect(persistedProviderFailure(failed("secret execution details"))).toBeUndefined()
  })
})
