import { describe, it, expect } from "vitest"
import { OpenCodeProvider } from "../../src/providers/opencode.js"

describe("OpenCodeProvider", () => {
  // Helper to create provider with dangerous local execution for unit testing
  const createTestProvider = () => new OpenCodeProvider({ dangerouslyAllowLocalExecution: true })

  describe("name", () => {
    it('should have name "opencode"', () => {
      const provider = createTestProvider()
      expect(provider.name).toBe("opencode")
    })
  })

  describe("constructor", () => {
    it("should throw if no sandbox or dangerous flag", () => {
      expect(() => new OpenCodeProvider({} as any)).toThrow(/sandbox/)
    })

    it("should accept dangerouslyAllowLocalExecution", () => {
      const provider = new OpenCodeProvider({ dangerouslyAllowLocalExecution: true })
      expect(provider.name).toBe("opencode")
    })
  })

  describe("getCommand", () => {
    it("should return basic command without session or model", () => {
      const provider = createTestProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("bash")
      expect(args[0]).toBe("-lc")
      expect(args[1]).toContain("opencode run")
      expect(args[1]).toContain("--format json")
      expect(args[1]).toContain("--variant medium")
      expect(args[1]).not.toContain("-m")
    })

    it("should include session flag with session ID", () => {
      const provider = createTestProvider()
      provider.sessionId = "run-456"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("bash")
      expect(args[1]).toContain("-s")
      expect(args[1]).toContain("run-456")
    })

    it("should include prompt in arguments", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ prompt: "Hello world" })

      expect(args[1]).toContain("Hello world")
    })

    it("should use custom model when provided", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "openai/gpt-4o-mini" })

      expect(args[1]).toContain("-m")
      expect(args[1]).toContain("openai/gpt-4o-mini")
    })

    it("should support anthropic models", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "anthropic/claude-sonnet" })

      expect(args[1]).toContain("-m")
      expect(args[1]).toContain("anthropic/claude-sonnet")
    })

    it("should support google models", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "google/gemini-2.0-flash" })

      expect(args[1]).toContain("-m")
      expect(args[1]).toContain("google/gemini-2.0-flash")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = createTestProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse step_start event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "step_start", "sessionID": "ses_xyz123"}')

      expect(event).toEqual({ type: "session", id: "ses_xyz123" })
    })

    it("should parse text event with content", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text", "text": "Processing..."}}'
      )

      expect(event).toEqual({ type: "token", text: "Processing..." })
    })

    it("should return null for text event without text type", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "image"}}'
      )

      expect(event).toBeNull()
    })

    it("should return null for text event without text content", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text"}}'
      )

      expect(event).toBeNull()
    })

    it("should parse tool_call event", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call", "tool": "write_file"}}'
      )

      expect(event).toEqual({ type: "tool_start", name: "write_file" })
    })

    it("should handle tool_call with missing tool name", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call"}}'
      )

      expect(event).toEqual({ type: "tool_start", name: "unknown" })
    })

    it("should parse tool_result event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool_result", "sessionID": "ses_xyz123"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse step_finish event (reason stop)", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "step_finish", "sessionID": "ses_xyz123", "part": {"reason": "stop"}}'
      )

      expect(event).toEqual({ type: "end" })
    })

    it("should parse error event with error message", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}'
      )

      expect(event).toEqual({ type: "end", error: "Rate limit exceeded" })
    })

    it("should parse error event falling back to error name", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError"}}'
      )

      expect(event).toEqual({ type: "end", error: "APIError" })
    })

    it("should return null for unknown event types", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "unknown"}')

      expect(event).toBeNull()
    })
  })
})
