import { describe, expect, it } from "vitest"
import { canConfirmThinkingRecovery, recoveryTargetKey, requiresThinkingRecovery, type ThinkingRecoveryRequest } from "./thinking-recovery"

const request: ThinkingRecoveryRequest = {
  id: "recovery-1", chatId: "chat-1", content: "Keep my text", agent: "codex", model: "gpt-6-luna",
  originalAgent: "codex", originalModel: "gpt-6.1-sol", originalThinking: "ultra",
}

describe("explicit recovery choice contract", () => {
  it.each([
    [{ agent: "codex", model: "gpt-6.1-sol" }, true],
    [{ agent: "opencode", model: "gpt-6-luna" }, true],
    [{ agent: "codex" }, true], [{ model: "gpt-6-luna" }, true], [{}, true],
    [{ agent: "codex", model: "gpt-6-luna" }, false],
  ])("does not infer a match for origin %j", (origin, needsConfirmation) => {
    expect(requiresThinkingRecovery(origin, request)).toBe(needsConfirmation)
  })

  it("never treats no user choice as consent to Default", () => {
    expect(canConfirmThinkingRecovery(request, undefined, { levels: [] }, true)).toBe(false)
  })

  it("accepts Default only after it was explicitly selected for this target", () => {
    expect(canConfirmThinkingRecovery(request, { targetKey: recoveryTargetKey(request), thinking: "default" }, { levels: [] }, true)).toBe(true)
  })

  it("rejects a choice made for another chat, target, or recovery attempt", () => {
    const choice = { targetKey: recoveryTargetKey(request), thinking: "high" }
    for (const change of [{ id: "recovery-2" }, { chatId: "chat-2" }, { agent: "claude-code" }, { model: "gpt-6.1-sol" }]) {
      expect(canConfirmThinkingRecovery({ ...request, ...change }, choice, { levels: ["high"] }, true)).toBe(false)
    }
  })

  it("rechecks a chosen level against a late capability response", () => {
    const choice = { targetKey: recoveryTargetKey(request), thinking: "high" }
    expect(canConfirmThinkingRecovery(request, choice, { levels: ["high"] }, false)).toBe(false)
    expect(canConfirmThinkingRecovery(request, choice, { levels: ["high"] }, true)).toBe(true)
    expect(canConfirmThinkingRecovery(request, choice, { levels: [] }, true)).toBe(false)
  })

  it("does not rewrite the original prompt or its queued settings", () => {
    const original = Object.freeze({ ...request })
    expect(canConfirmThinkingRecovery(original, { targetKey: recoveryTargetKey(original), thinking: "high" }, { levels: ["high"] }, true)).toBe(true)
    expect(original.originalThinking).toBe("ultra")
    expect(original.content).toBe("Keep my text")
  })
})
