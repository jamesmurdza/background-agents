import { describe, it, expect } from "vitest"

import { parseSecretMarker, secretName, SECRET_NAME_PATTERN, SECRET_PREFIX, toSecretMarker } from "../src/index"

describe("secretName", () => {
  it("derives a stable, valid name that doesn't reveal the value", () => {
    const name = secretName("sk-some-key")
    expect(name).toMatch(new RegExp(`^${SECRET_PREFIX}[0-9a-f]{16}$`))
    expect(name).toMatch(SECRET_NAME_PATTERN)
    expect(secretName("sk-some-key")).toBe(name)
    expect(secretName("sk-other-key")).not.toBe(name)
    expect(name).not.toContain("some-key")
  })

  it("distinguishes the same value restricted to different hosts", () => {
    expect(secretName("v", ["a.com"])).not.toBe(secretName("v", ["b.com"]))
    expect(secretName("v")).toBe(secretName("v", []))
  })
})

describe("secret markers", () => {
  it("round-trips a marker and rejects anything else", () => {
    expect(parseSecretMarker(toSecretMarker("s1"))).toBe("s1")
    expect(parseSecretMarker("sk-plain-key")).toBeUndefined()
    expect(parseSecretMarker(toSecretMarker(""))).toBeUndefined()
    expect(parseSecretMarker(undefined)).toBeUndefined()
    expect(parseSecretMarker(null)).toBeUndefined()
  })
})
