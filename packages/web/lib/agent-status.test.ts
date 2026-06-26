/**
 * Unit tests for the agent readiness/status logic behind the picker dot:
 * agentSharedPoolExhausted plus its effect on agentHasFreeUsage / agentIsReady.
 *
 * Pure functions — no mocks. The interesting case is the Claude shared pool
 * being used up: the picker should show a red ("exhausted") dot, not green.
 */
import { describe, it, expect } from "vitest"
import {
  agentSharedPoolExhausted,
  agentHasFreeUsage,
  agentIsReady,
  type CredentialFlags,
} from "@background-agents/common"

const sharedPoolFresh: CredentialFlags = { CLAUDE_SHARED_POOL_AVAILABLE: true }
const sharedPoolUsedUp: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  CLAUDE_DAILY_LIMIT_EXCEEDED: true,
}
const ownKeyButLimit: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  CLAUDE_DAILY_LIMIT_EXCEEDED: true,
  ANTHROPIC_API_KEY: true,
}

describe("agentSharedPoolExhausted", () => {
  it("is true when the Claude shared pool is used up and there's no own key", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolUsedUp)).toBe(true)
  })

  it("is false when the shared pool still has budget", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolFresh)).toBe(false)
  })

  it("is false when the user has their own Anthropic key to fall back on", () => {
    expect(agentSharedPoolExhausted("claude-code", ownKeyButLimit)).toBe(false)
  })

  it("is false for agents without a metered shared pool", () => {
    expect(agentSharedPoolExhausted("opencode", sharedPoolUsedUp)).toBe(false)
    expect(agentSharedPoolExhausted("kilo", sharedPoolUsedUp)).toBe(false)
  })
})

describe("readiness when the Claude pool is used up", () => {
  it("no longer reports free usage (so the dot won't be green)", () => {
    expect(agentHasFreeUsage("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentHasFreeUsage("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("is not 'ready' when exhausted with no fallback credential", () => {
    expect(agentIsReady("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentIsReady("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("stays ready when the user has their own key despite the limit", () => {
    expect(agentIsReady("claude-code", ownKeyButLimit)).toBe(true)
  })
})
