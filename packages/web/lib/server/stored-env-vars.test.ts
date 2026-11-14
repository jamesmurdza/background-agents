import { describe, expect, it } from "vitest"
import { decrypt, encrypt } from "@/lib/db/encryption"
import { decryptStoredEnvVar, decryptStoredEnvVars, encryptEnvVars } from "./stored-env-vars"

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

describe("decryptStoredEnvVars", () => {
  it("decrypts every value in the map", () => {
    expect(decryptStoredEnvVars({ A: encrypt("1"), B: encrypt("2") })).toEqual({ A: "1", B: "2" })
  })

  it("skips empty values", () => {
    expect(decryptStoredEnvVars({ A: encrypt("1"), B: "" })).toEqual({ A: "1" })
  })
})

describe("encryptEnvVars", () => {
  it("trims keys and encrypts values", () => {
    const encrypted = encryptEnvVars({ " A ": "1" })
    expect(Object.keys(encrypted)).toEqual(["A"])
    expect(decrypt(encrypted.A)).toBe("1")
  })

  it("drops blank keys and non-string values", () => {
    expect(encryptEnvVars({ " ": "1", A: 2 as unknown as string })).toEqual({})
  })
})
