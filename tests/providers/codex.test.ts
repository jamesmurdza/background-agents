import { describe, it, expect } from "vitest"
import { CodexProvider } from "../../src/providers/codex.js"

describe("CodexProvider", () => {
  // Helper to create provider with dangerous local execution for unit testing
  const createTestProvider = () => new CodexProvider({ dangerouslyAllowLocalExecution: true })

  describe("name", () => {
    it('should have name "codex"', () => {
      const provider = createTestProvider()
      expect(provider.name).toBe("codex")
    })
  })

  describe("constructor", () => {
    it("should throw if no sandbox or dangerous flag", () => {
      expect(() => new CodexProvider({} as any)).toThrow(/sandbox/)
    })

    it("should accept dangerouslyAllowLocalExecution", () => {
      const provider = new CodexProvider({ dangerouslyAllowLocalExecution: true })
      expect(provider.name).toBe("codex")
    })
  })

  describe("getCommand", () => {
    it("should return exec command with JSON output", () => {
      const provider = createTestProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("codex")
      expect(args).toContain("exec")
      expect(args).toContain("--json")
    })

    it("should include prompt when provided", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ prompt: "Hello world" })

      expect(args).toContain("Hello world")
    })

    it("should include resume flag with session ID", () => {
      const provider = createTestProvider()
      provider.sessionId = "thread-123"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("codex")
      expect(args).toContain("resume")
      expect(args).toContain("thread-123")
    })

    it("should include model when provided", () => {
      const provider = createTestProvider()
      const { args } = provider.getCommand({ model: "gpt-4o" })

      expect(args).toContain("--model")
      expect(args).toContain("gpt-4o")
    })

    it("should support o1 and o3 models", () => {
      const provider = createTestProvider()
      const { args: args1 } = provider.getCommand({ model: "o1" })
      const { args: args2 } = provider.getCommand({ model: "o3" })

      expect(args1).toContain("--model")
      expect(args1).toContain("o1")
      expect(args2).toContain("--model")
      expect(args2).toContain("o3")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = createTestProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse thread.started event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "thread.started", "thread_id": "thread_abc"}')

      expect(event).toEqual({ type: "session", id: "thread_abc" })
    })

    it("should parse item.message.delta event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "item.message.delta", "text": "Hello"}')

      expect(event).toEqual({ type: "token", text: "Hello" })
    })

    it("should parse item.tool.start event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "item.tool.start", "name": "shell"}')

      expect(event).toEqual({ type: "tool_start", name: "shell" })
    })

    it("should parse item.tool.input.delta event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "item.tool.input.delta", "text": "ls -la"}')

      expect(event).toEqual({ type: "tool_delta", text: "ls -la" })
    })

    it("should parse item.tool.end event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "item.tool.end"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse turn.completed event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "turn.completed"}')

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "unknown.event"}')

      expect(event).toBeNull()
    })
  })
})
