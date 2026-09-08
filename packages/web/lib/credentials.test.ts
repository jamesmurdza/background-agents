import { describe, it, expect } from "vitest"
import { isClientWritableCredential, CREDENTIAL_KEYS, flagsFromCredentials } from "./credentials"
import type { CodexStoredCredential } from "./codex-credentials"

describe("isClientWritableCredential", () => {
  it("rejects the server-managed Codex subscription", () => {
    expect(isClientWritableCredential("CODEX_CREDENTIALS")).toBe(false)
  })

  it("accepts ordinary pasted keys", () => {
    expect(isClientWritableCredential("OPENAI_API_KEY")).toBe(true)
    expect(isClientWritableCredential("CLAUDE_CODE_CREDENTIALS")).toBe(true)
  })

  it("treats every field without an explicit serverManaged flag as writable", () => {
    for (const field of CREDENTIAL_KEYS) {
      expect(isClientWritableCredential(field.id)).toBe(!field.serverManaged)
    }
  })
})

describe("flagsFromCredentials", () => {
  function codexBlob(status: CodexStoredCredential["status"]): string {
    return JSON.stringify({
      refresh_token: "rt",
      access_token: "at",
      id_token: "id",
      account_id: "acct",
      expires_at: 1,
      earliest_refresh_at: 1,
      last_refresh: new Date(0).toISOString(),
      status,
    })
  }

  it("flags a connected Codex subscription as available", () => {
    expect(flagsFromCredentials({ CODEX_CREDENTIALS: codexBlob("connected") }).CODEX_CREDENTIALS).toBe(
      true
    )
  })

  it("does not flag a subscription that needs reconnecting", () => {
    // Presence alone used to unlock the Codex models here, so a user whose
    // grant OpenAI had rejected could still pick a Codex model and get an
    // opaque agent-side failure instead of the reconnect prompt.
    expect(
      flagsFromCredentials({ CODEX_CREDENTIALS: codexBlob("needs_reconnect") }).CODEX_CREDENTIALS
    ).toBe(false)
  })

  it("does not flag an unparseable stored value", () => {
    expect(flagsFromCredentials({ CODEX_CREDENTIALS: "not-json" }).CODEX_CREDENTIALS).toBe(false)
    expect(flagsFromCredentials({}).CODEX_CREDENTIALS).toBe(false)
  })

  it("keeps plain presence semantics for every other credential id", () => {
    const flags = flagsFromCredentials({ OPENAI_API_KEY: "sk-1", CLAUDE_CODE_CREDENTIALS: "{}" })
    expect(flags.OPENAI_API_KEY).toBe(true)
    expect(flags.CLAUDE_CODE_CREDENTIALS).toBe(true)
    expect(flags.ANTHROPIC_API_KEY).toBe(false)
  })
})
