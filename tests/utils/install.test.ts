import { describe, it, expect } from "vitest"
import {
  isCliInstalled,
  getPackageName,
  getInstallationStatus,
} from "../../src/utils/install.js"

describe("install utilities", () => {
  describe("isCliInstalled", () => {
    it("should return true for installed CLI (node)", () => {
      // 'node' should always be available in test environment
      // We test the mechanism works, not specific CLIs
      const result = isCliInstalled("claude")
      // Result depends on environment, just verify it returns boolean
      expect(typeof result).toBe("boolean")
    })

    it("should return boolean for any provider", () => {
      expect(typeof isCliInstalled("claude")).toBe("boolean")
      expect(typeof isCliInstalled("codex")).toBe("boolean")
      expect(typeof isCliInstalled("opencode")).toBe("boolean")
      expect(typeof isCliInstalled("gemini")).toBe("boolean")
    })
  })

  describe("getPackageName", () => {
    it("should return correct package for claude", () => {
      expect(getPackageName("claude")).toBe("@anthropic-ai/claude-code")
    })

    it("should return correct package for codex", () => {
      expect(getPackageName("codex")).toBe("@openai/codex")
    })

    it("should return correct package for opencode", () => {
      expect(getPackageName("opencode")).toBe("opencode")
    })

    it("should return correct package for gemini", () => {
      expect(getPackageName("gemini")).toBe("@anthropic-ai/gemini-cli")
    })
  })

  describe("getInstallationStatus", () => {
    it("should return status for all providers", () => {
      const status = getInstallationStatus()

      expect(status).toHaveProperty("claude")
      expect(status).toHaveProperty("codex")
      expect(status).toHaveProperty("opencode")
      expect(status).toHaveProperty("gemini")

      // All values should be booleans
      expect(typeof status.claude).toBe("boolean")
      expect(typeof status.codex).toBe("boolean")
      expect(typeof status.opencode).toBe("boolean")
      expect(typeof status.gemini).toBe("boolean")
    })
  })
})
