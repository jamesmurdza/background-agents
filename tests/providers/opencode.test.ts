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
    it("should return basic command without session", () => {
      const provider = createTestProvider()
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("opencode")
      expect(args).toContain("run")
      expect(args).toContain("--format")
      expect(args).toContain("json")
    })

    it("should include session flag with session ID", () => {
      const provider = createTestProvider()
      provider.sessionId = "run-456"
      const { cmd, args } = provider.getCommand()

      expect(cmd).toBe("opencode")
      expect(args).toContain("-s")
      expect(args).toContain("run-456")
    })
  })

  describe("parse", () => {
    it("should return null for invalid JSON", () => {
      const provider = createTestProvider()

      expect(provider.parse("not json")).toBeNull()
      expect(provider.parse("")).toBeNull()
    })

    it("should parse run.started event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "run.started", "run_id": "run_xyz"}')

      expect(event).toEqual({ type: "session", id: "run_xyz" })
    })

    it("should parse message.part.updated event with text", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "message.part.updated", "part": {"type": "text", "text": "Processing..."}}'
      )

      expect(event).toEqual({ type: "token", text: "Processing..." })
    })

    it("should return null for message.part.updated without text type", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "message.part.updated", "part": {"type": "image"}}'
      )

      expect(event).toBeNull()
    })

    it("should return null for message.part.updated without text content", () => {
      const provider = createTestProvider()
      const event = provider.parse(
        '{"type": "message.part.updated", "part": {"type": "text"}}'
      )

      expect(event).toBeNull()
    })

    it("should parse tool.start event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.start", "tool": "write_file"}')

      expect(event).toEqual({ type: "tool_start", name: "write_file" })
    })

    it("should parse tool.input.delta event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.input.delta", "text": "content here"}')

      expect(event).toEqual({ type: "tool_delta", text: "content here" })
    })

    it("should parse tool.completed event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "tool.completed"}')

      expect(event).toEqual({ type: "tool_end" })
    })

    it("should parse run.completed event", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "run.completed"}')

      expect(event).toEqual({ type: "end" })
    })

    it("should return null for unknown event types", () => {
      const provider = createTestProvider()
      const event = provider.parse('{"type": "unknown"}')

      expect(event).toBeNull()
    })
  })
})
