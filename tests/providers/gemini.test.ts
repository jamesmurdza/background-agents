import { describe, it, expect } from "vitest"
import { GeminiProvider } from "../../src/providers/gemini.js"

describe("GeminiProvider", () => {
  // Helper to create provider with dangerous local execution for unit testing
  const createTestProvider = () => new GeminiProvider({ dangerouslyAllowLocalExecution: true })

  describe("name", () => {
    it('should have name "gemini"', () => {
      const provider = createTestProvider()
      expect(provider.name).toBe("gemini")
    })
  })

  describe("constructor", () => {
    it("should throw if no sandbox or dangerous flag", () => {
      expect(() => new GeminiProvider({} as any)).toThrow(/sandbox/)
    })

    it("should accept dangerouslyAllowLocalExecution", () => {
      const provider = new GeminiProvider({ dangerouslyAllowLocalExecution: true })
      expect(provider.name).toBe("gemini")
    })
  })

  describe("getCommand", () => {
    it("should return basic command without session", () => {
      const provider = createTestProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("gemini")
      expect(args).toEqual([])
    })

    it("should include resume flag with session ID", () => {
      const provider = createTestProvider()
      provider.sessionId = "session-789"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("gemini")
      expect(args).toContain("--resume")
      expect(args).toContain("session-789")
    })

    it("should include model when provided", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "gemini-2.0-flash" })

      expect(args).toContain("--model")
      expect(args).toContain("gemini-2.0-flash")
    })

    it("should include prompt when provided", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ prompt: "Hello" })

      expect(args).toContain("Hello")
    })

    it("should support gemini-1.5-pro model", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "gemini-1.5-pro" })

      expect(args).toContain("--model")
      expect(args).toContain("gemini-1.5-pro")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = createTestProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse init event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "init", "session_id": "gemini_session"}')

      expect(event).toEqual({ type: "session", id: "gemini_session" })
    })

    it("should parse assistant.delta event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "assistant.delta", "text": "Sure, I can help"}')

      expect(event).toEqual({ type: "token", text: "Sure, I can help" })
    })

    it("should parse tool.start event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.start", "name": "execute_code"}')

      expect(event).toEqual({ type: "tool_start", name: "execute_code" })
    })

    it("should parse tool.delta event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.delta", "text": "running..."}')

      expect(event).toEqual({ type: "tool_delta", text: "running..." })
    })

    it("should parse tool.end event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.end"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse assistant.complete event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "assistant.complete"}')

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "unknown"}')

      expect(event).toBeNull()
    })
  })
})
