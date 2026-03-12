import { describe, it, expect } from "vitest"
import { ClaudeProvider } from "../../src/providers/claude.js"

describe("ClaudeProvider", () => {
  describe("name", () => {
    it('should have name "claude"', () => {
      const provider = new ClaudeProvider()
      expect(provider.name).toBe("claude")
    })
  })

  describe("getCommand", () => {
    it("should return basic command with print mode and stream-json", () => {
      const provider = new ClaudeProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("claude")
      expect(args).toContain("-p")
      expect(args).toContain("--output-format")
      expect(args).toContain("stream-json")
      expect(args).toContain("--verbose")
    })

    it("should include resume flag with session ID", () => {
      const provider = new ClaudeProvider()
      provider.sessionId = "test-session-123"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("claude")
      expect(args).toContain("--resume")
      expect(args).toContain("test-session-123")
    })

    it("should include prompt when provided", () => {
      const provider = new ClaudeProvider()
      const { args } = provider.getCommand({ prompt: "Hello world" })

      expect(args).toContain("Hello world")
    })

    it("should use session from options over provider session", () => {
      const provider = new ClaudeProvider()
      provider.sessionId = "old-session"
      const { args } = provider.getCommand({ sessionId: "option-session" })

      // Should use provider's sessionId when available
      expect(args).toContain("old-session")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = new ClaudeProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse system init event", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        '{"type": "system", "subtype": "init", "session_id": "abc-123"}'
      )

      expect(event).toEqual({ type: "session", id: "abc-123" })
    })

    it("should parse assistant message with text", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "text", text: "Hello from Claude!" }]
        },
        session_id: "abc-123"
      }))

      expect(event).toEqual({ type: "token", text: "Hello from Claude!" })
    })

    it("should parse assistant message with tool_use", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: [{ type: "tool_use", name: "read_file" }]
        },
        session_id: "abc-123"
      }))

      expect(event).toEqual({ type: "tool_start", name: "read_file" })
    })

    it("should return null for assistant message with empty content", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          content: []
        },
        session_id: "abc-123"
      }))

      expect(event).toBeNull()
    })

    it("should parse tool_use event", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('{"type": "tool_use", "name": "bash"}')

      expect(event).toEqual({ type: "tool_start", name: "bash" })
    })

    it("should parse tool_result event", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('{"type": "tool_result", "tool_use_id": "tool_123"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse result event", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        '{"type": "result", "subtype": "success", "result": "Done", "session_id": "abc-123"}'
      )

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('{"type": "unknown_event"}')

      expect(event).toBeNull()
    })

    it("should handle malformed JSON", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse("{not valid json}")

      expect(event).toBeNull()
    })
  })
})
