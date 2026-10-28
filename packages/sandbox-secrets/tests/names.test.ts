import { describe, it, expect } from "vitest"

import { contentSecretName, parseSecretMarker, SECRET_NAME_PATTERN, toSecretMarker } from "../src/index"

describe("contentSecretName", () => {
  it("derives a stable, valid name that doesn't reveal the value", () => {
    const name = contentSecretName("opencode_", "sk-some-key")
    expect(name).toMatch(/^opencode_[0-9a-f]{12}$/)
    expect(name).toMatch(SECRET_NAME_PATTERN)
    expect(contentSecretName("opencode_", "sk-some-key")).toBe(name)
    expect(contentSecretName("opencode_", "sk-other-key")).not.toBe(name)
    expect(name).not.toContain("some-key")
  })

  it("takes the hash length", () => {
    expect(contentSecretName("p_", "v", 8)).toMatch(/^p_[0-9a-f]{8}$/)
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
