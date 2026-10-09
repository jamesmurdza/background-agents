import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildSharedClaudeEnv, createClaudeTokenCapability, verifyClaudeTokenCapability } from "./claude-token-auth"

const scope = { userId: "user-test", chatId: "chat-test", backgroundSessionId: "run-test" }
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "token-read-signing-test")
  vi.stubEnv("NEXTAUTH_URL", "https://app.test")
  vi.stubEnv("CLAUDE_CREDENTIALS_BASE_URL", "")
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe("shared Claude token capabilities", () => {
  it("verifies the signed user, chat and run", () => {
    expect(verifyClaudeTokenCapability(createClaudeTokenCapability(scope))).toEqual(scope)
  })

  it.each(["", "x.y", "a.b.c", "a.!", "x".repeat(4097)])("rejects malformed capabilities", (token) => {
    expect(verifyClaudeTokenCapability(token)).toBeNull()
  })

  it("rejects modified scope and another signing key", () => {
    const token = createClaudeTokenCapability(scope)
    const payload = Buffer.from(JSON.stringify({ ...scope, userId: "another-user", expiresAt: Date.now() + 10000 })).toString("base64url")
    expect(verifyClaudeTokenCapability(`${payload}.${token.split(".")[1]}`)).toBeNull()
    vi.stubEnv("NEXTAUTH_SECRET", "another-signing-test")
    expect(verifyClaudeTokenCapability(token)).toBeNull()
  })

  it("expires a capability even if the run remains active", () => {
    vi.useFakeTimers()
    const token = createClaudeTokenCapability(scope)
    vi.advanceTimersByTime(27 * 60 * 60 * 1000)
    expect(verifyClaudeTokenCapability(token)).toBeNull()
  })

  it("requires the server signing secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(() => createClaudeTokenCapability(scope)).toThrow("NEXTAUTH_SECRET")
  })

  it("uses direct inference and passes only a run capability to the OAuth bridge", () => {
    vi.stubEnv("CLAUDE_CREDENTIALS_BASE_URL", "https://tunnel.test")
    const env = buildSharedClaudeEnv({ CLAUDE_CODE_CREDENTIALS: "refresh-secret-test",
      ANTHROPIC_BASE_URL: "https://old-gateway.test", ANTHROPIC_AUTH_TOKEN: "old-token-test",
      ANTHROPIC_API_KEY: "old-key-test", CLAUDE_CODE_USE_VERTEX: "1", PROJECT_SETTING: "preserved" }, scope)
    expect(env.CLAUDE_CODE_TOKEN_URL).toBe("https://tunnel.test/api/claude-token")
    expect(verifyClaudeTokenCapability(env.CLAUDE_CODE_TOKEN_AUTH)).toEqual(scope)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_CREDENTIALS).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
    expect(env.PROJECT_SETTING).toBe("preserved")
    expect(JSON.stringify(env)).not.toMatch(/refresh-secret-test|old-token-test|old-key-test/)
  })

  it("defaults credential reads to the public app URL", () => {
    expect(buildSharedClaudeEnv({}, scope).CLAUDE_CODE_TOKEN_URL).toBe("https://app.test/api/claude-token")
  })

  it.each(["http://app.test", "https://user:password@app.test", "https://app.test?token=private"])(
    "rejects insecure or credential-bearing production URLs", (url) => {
      vi.stubEnv("NODE_ENV", "production")
      vi.stubEnv("CLAUDE_CREDENTIALS_BASE_URL", url)
      expect(() => buildSharedClaudeEnv({}, scope)).toThrow("HTTPS app URL")
    }
  )
})
