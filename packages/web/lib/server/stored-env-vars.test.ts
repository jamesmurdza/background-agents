import { describe, expect, it } from "vitest"
import { encrypt } from "@/lib/db/encryption"
import { decryptStoredEnvVar } from "./stored-env-vars"

describe("decryptStoredEnvVar", () => {
  it("reads a plain var, and a once-locked one as plain", () => {
    expect(decryptStoredEnvVar(encrypt("value"))).toBe("value")
    expect(decryptStoredEnvVar({ v: encrypt("locked"), hosts: ["api.example.com"] })).toBe("locked")
  })

  it("reads anything else as empty", () => {
    expect(decryptStoredEnvVar(null)).toBe("")
    expect(decryptStoredEnvVar({ hosts: [] })).toBe("")
  })
})
