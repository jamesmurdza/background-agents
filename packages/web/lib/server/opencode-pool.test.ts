/**
 * Unit tests for the shared OpenCode key pool.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import {
  fingerprintKey,
  getSharedOpencodeKeys,
  getSharedOpencodeSecretNames,
  hasSharedOpencodeKey,
  parseSecretMarker,
  pickSharedOpencodeKey,
  toSecretMarker,
} from "./opencode-pool"

const KEY = "OPENCODE_API_KEY"
const SECRETS = "OPENCODE_DAYTONA_SECRETS"

afterEach(() => {
  delete process.env[KEY]
  delete process.env[SECRETS]
  vi.restoreAllMocks()
})

describe("getSharedOpencodeKeys", () => {
  it("returns [] when the key is not configured", () => {
    expect(getSharedOpencodeKeys()).toEqual([])
    expect(hasSharedOpencodeKey()).toBe(false)
  })

  it("returns a single key when one is set", () => {
    process.env[KEY] = "primary"
    expect(getSharedOpencodeKeys()).toEqual(["primary"])
    expect(hasSharedOpencodeKey()).toBe(true)
  })

  it("splits comma-separated keys, trimming whitespace", () => {
    process.env[KEY] = " primary , secondary , third "
    expect(getSharedOpencodeKeys()).toEqual(["primary", "secondary", "third"])
  })

  it("drops blank entries between commas", () => {
    process.env[KEY] = "primary,,   ,secondary"
    expect(getSharedOpencodeKeys()).toEqual(["primary", "secondary"])
  })

  it("returns [] for an all-blank value", () => {
    process.env[KEY] = "  , ,  "
    expect(getSharedOpencodeKeys()).toEqual([])
    expect(hasSharedOpencodeKey()).toBe(false)
  })
})

describe("pickSharedOpencodeKey", () => {
  it("returns undefined when nothing is configured", () => {
    expect(pickSharedOpencodeKey()).toBeUndefined()
  })

  it("returns the single key when only one is configured", () => {
    process.env[KEY] = "primary"
    expect(pickSharedOpencodeKey()).toBe("primary")
  })

  it("selects by Math.random across all keys", () => {
    process.env[KEY] = "a,b,c"
    // Math.random in [0, 1/3) → index 0, [1/3, 2/3) → index 1, [2/3, 1) → index 2.
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(pickSharedOpencodeKey()).toBe("a")
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(pickSharedOpencodeKey()).toBe("b")
    vi.spyOn(Math, "random").mockReturnValue(0.9)
    expect(pickSharedOpencodeKey()).toBe("c")
  })

  it("spreads roughly evenly across all keys over many draws", () => {
    process.env[KEY] = "a,b,c"
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 6000; i++) counts[pickSharedOpencodeKey()!]++
    // Each should land well within a generous band around 1/3 (2000).
    expect(counts.a).toBeGreaterThan(1600)
    expect(counts.b).toBeGreaterThan(1600)
    expect(counts.c).toBeGreaterThan(1600)
  })
})

describe("fingerprintKey", () => {
  it("returns the last 5 characters", () => {
    expect(fingerprintKey("sk-FfNFvxqVaeomabGUvXpW4GCSdZK05tlBCBFDFhXd5p1TMXmz6YJOAoHIrEWCa2RK")).toBe(
      "Ca2RK"
    )
  })

  it("distinguishes keys sharing a long common prefix", () => {
    const a = fingerprintKey(`sk-${"x".repeat(60)}AAAAA`)
    const b = fingerprintKey(`sk-${"x".repeat(60)}BBBBB`)
    expect(a).toBe("AAAAA")
    expect(b).toBe("BBBBB")
    expect(a).not.toBe(b)
  })

  it("never returns enough to reconstruct the key", () => {
    const key = "sk-supersecretcredentialvaluethatmustnotleak12345"
    const fp = fingerprintKey(key)!
    expect(fp).toHaveLength(5)
    expect(key).not.toBe(fp)
    expect(key.startsWith(fp)).toBe(false)
  })

  it("ignores surrounding whitespace so it matches the parsed pool value", () => {
    expect(fingerprintKey("  sk-abcdefghij  ")).toBe("fghij")
  })

  it("returns undefined for missing or too-short input", () => {
    expect(fingerprintKey(undefined)).toBeUndefined()
    expect(fingerprintKey(null)).toBeUndefined()
    expect(fingerprintKey("")).toBeUndefined()
    expect(fingerprintKey("abcd")).toBeUndefined()
  })
})

describe("secrets mode", () => {
  it("parses the configured secret names", () => {
    process.env[SECRETS] = " OPENCODE_API_KEY_1 , ,OPENCODE_API_KEY_2 "
    expect(getSharedOpencodeSecretNames()).toEqual(["OPENCODE_API_KEY_1", "OPENCODE_API_KEY_2"])
    expect(hasSharedOpencodeKey()).toBe(true)
  })

  it("picks a secret marker, never a raw key, even when raw keys are also set", () => {
    process.env[KEY] = "raw-key-value"
    process.env[SECRETS] = "s1,s2"
    vi.spyOn(Math, "random").mockReturnValue(0.9)
    const picked = pickSharedOpencodeKey()
    expect(picked).toBe(toSecretMarker("s2"))
    expect(picked).not.toContain("raw-key-value")
  })

  it("round-trips a marker and rejects plain keys", () => {
    expect(parseSecretMarker(toSecretMarker("s1"))).toBe("s1")
    expect(parseSecretMarker("sk-plain-key")).toBeUndefined()
    expect(parseSecretMarker(toSecretMarker(""))).toBeUndefined()
    expect(parseSecretMarker(undefined)).toBeUndefined()
  })

  it("fingerprints a marker as the secret name", () => {
    expect(fingerprintKey(toSecretMarker("OPENCODE_API_KEY_1"))).toBe("OPENCODE_API_KEY_1")
  })
})
