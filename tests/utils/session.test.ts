import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  loadSession,
  storeSession,
  clearSession,
  getDefaultSessionPath,
} from "../../src/utils/session.js"

describe("session utilities", () => {
  let tempDir: string
  let testSessionFile: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"))
    testSessionFile = path.join(tempDir, "test-session")
  })

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("getDefaultSessionPath", () => {
    it("should return a path containing the provider name", () => {
      const sessionPath = getDefaultSessionPath("claude")
      expect(sessionPath).toContain("claude")
      expect(sessionPath).toContain("session")
    })

    it("should return different paths for different providers", () => {
      const claudePath = getDefaultSessionPath("claude")
      const codexPath = getDefaultSessionPath("codex")
      expect(claudePath).not.toBe(codexPath)
    })
  })

  describe("loadSession", () => {
    it("should return null for non-existent file", () => {
      const result = loadSession(path.join(tempDir, "nonexistent"))
      expect(result).toBeNull()
    })

    it("should load session from file", () => {
      const sessionId = "test-session-123"
      fs.writeFileSync(testSessionFile, sessionId)

      const result = loadSession(testSessionFile)
      expect(result).toBe(sessionId)
    })

    it("should trim whitespace from session ID", () => {
      fs.writeFileSync(testSessionFile, "  session-id  \n")

      const result = loadSession(testSessionFile)
      expect(result).toBe("session-id")
    })

    it("should return null for empty file", () => {
      fs.writeFileSync(testSessionFile, "")

      const result = loadSession(testSessionFile)
      expect(result).toBeNull()
    })

    it("should return null for whitespace-only file", () => {
      fs.writeFileSync(testSessionFile, "   \n  ")

      const result = loadSession(testSessionFile)
      expect(result).toBeNull()
    })
  })

  describe("storeSession", () => {
    it("should store session to file", () => {
      const sessionId = "test-session-456"

      const result = storeSession(testSessionFile, sessionId)
      expect(result).toBe(true)

      const stored = fs.readFileSync(testSessionFile, "utf8")
      expect(stored).toBe(sessionId)
    })

    it("should create parent directories if needed", () => {
      const nestedPath = path.join(tempDir, "a", "b", "c", "session")

      const result = storeSession(nestedPath, "nested-session")
      expect(result).toBe(true)

      const stored = fs.readFileSync(nestedPath, "utf8")
      expect(stored).toBe("nested-session")
    })

    it("should overwrite existing session", () => {
      storeSession(testSessionFile, "old-session")
      storeSession(testSessionFile, "new-session")

      const stored = fs.readFileSync(testSessionFile, "utf8")
      expect(stored).toBe("new-session")
    })
  })

  describe("clearSession", () => {
    it("should delete session file", () => {
      fs.writeFileSync(testSessionFile, "session-to-delete")

      const result = clearSession(testSessionFile)
      expect(result).toBe(true)
      expect(fs.existsSync(testSessionFile)).toBe(false)
    })

    it("should return true for non-existent file", () => {
      const result = clearSession(path.join(tempDir, "nonexistent"))
      expect(result).toBe(true)
    })
  })
})
