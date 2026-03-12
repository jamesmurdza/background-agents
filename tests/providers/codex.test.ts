import { describe, it, expect } from "vitest"
import { CodexProvider } from "../../src/providers/codex.js"

describe("CodexProvider", () => {
  describe("name", () => {
    it('should have name "codex"', () => {
      const provider = new CodexProvider()
      expect(provider.name).toBe("codex")
    })
  })

  describe("getCommand", () => {
    it("should return basic command without session", () => {
      const provider = new CodexProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("codex")
      expect(args).toEqual([])
    })

    it("should include resume flag with session ID", () => {
      const provider = new CodexProvider()
      provider.sessionId = "thread-123"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("codex")
      expect(args).toContain("resume")
      expect(args).toContain("thread-123")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = new CodexProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse thread.started event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "thread.started", "thread_id": "thread_abc"}')

      expect(event).toEqual({ type: "session", id: "thread_abc" })
    })

    it("should parse item.message.delta event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "item.message.delta", "text": "Hello"}')

      expect(event).toEqual({ type: "token", text: "Hello" })
    })

    it("should parse item.tool.start event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "item.tool.start", "name": "shell"}')

      expect(event).toEqual({ type: "tool_start", name: "shell" })
    })

    it("should parse item.tool.input.delta event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "item.tool.input.delta", "text": "ls -la"}')

      expect(event).toEqual({ type: "tool_delta", text: "ls -la" })
    })

    it("should parse item.tool.end event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "item.tool.end"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse turn.completed event", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "turn.completed"}')

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = new CodexProvider()
      const event = provider.parse('{"type": "unknown.event"}')

      expect(event).toBeNull()
    })
  })
})
