import { describe, it, expect } from "vitest"
import { isClientWritableCredential, CREDENTIAL_KEYS } from "./credentials"

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
