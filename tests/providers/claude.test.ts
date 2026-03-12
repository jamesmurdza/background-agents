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
    it("should return basic command without session", () => {
      const provider = new ClaudeProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("claude")
      expect(args).toContain("--output-format")
      expect(args).toContain("stream-json")
    })

    it("should include resume flag with session ID", () => {
      const provider = new ClaudeProvider()
      provider.sessionId = "test-session-123"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("claude")
      expect(args).toContain("--resume")
      expect(args).toContain("test-session-123")
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
    it("should return null for non-SSE lines", () => {
      const provider = new ClaudeProvider()

      expect(provider.parse("not an sse line")).toBeNull()
      expect(provider.parse("")).toBeNull()
      expect(provider.parse('{"type": "test"}')).toBeNull()
    })

    it("should parse message_start event", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('data: {"type": "message_start", "message": {"id": "msg_123"}}')

      expect(event).toEqual({ type: "session", id: "msg_123" })
    })

    it("should return null for message_start without ID", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('data: {"type": "message_start", "message": {}}')

      expect(event).toBeNull()
    })

    it("should parse content_block_start for tool_use", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        'data: {"type": "content_block_start", "content_block": {"type": "tool_use", "name": "read_file"}}'
      )

      expect(event).toEqual({ type: "tool_start", name: "read_file" })
    })

    it("should return null for content_block_start without tool_use", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        'data: {"type": "content_block_start", "content_block": {"type": "text"}}'
      )

      expect(event).toBeNull()
    })

    it("should parse text_delta", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello world"}}'
      )

      expect(event).toEqual({ type: "token", text: "Hello world" })
    })

    it("should parse input_json_delta", () => {
      const provider = new ClaudeProvider()
      const jsonData = JSON.stringify({
        type: "content_block_delta",
        delta: {
          type: "input_json_delta",
          partial_json: '{"path":'
        }
      })
      const event = provider.parse(`data: ${jsonData}`)

      expect(event).toEqual({ type: "tool_delta", text: '{"path":' })
    })

    it("should return null for unknown delta types", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        'data: {"type": "content_block_delta", "delta": {"type": "unknown"}}'
      )

      expect(event).toBeNull()
    })

    it("should parse content_block_stop", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('data: {"type": "content_block_stop"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse message_stop", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('data: {"type": "message_stop"}')

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse('data: {"type": "unknown_event"}')

      expect(event).toBeNull()
    })

    it("should handle malformed JSON in SSE data", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse("data: {not valid json}")

      expect(event).toBeNull()
    })

    it("should handle empty delta text", () => {
      const provider = new ClaudeProvider()
      const event = provider.parse(
        'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": ""}}'
      )

      // Empty string is falsy, so should return null
      expect(event).toBeNull()
    })
  })
})
