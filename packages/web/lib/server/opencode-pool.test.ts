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
  secretNameForKey,
  sharedOpencodeKeyForSecret,
  toSecretMarker,
} from "./opencode-pool"

const KEY = "OPENCODE_API_KEY"
const marker = (key: string) => toSecretMarker(secretNameForKey(key))

afterEach(() => {
  delete process.env[KEY]
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

  it("returns the single key's secret marker when only one is configured", () => {
    process.env[KEY] = "primary"
    expect(pickSharedOpencodeKey()).toBe(marker("primary"))
  })

  it("never returns the raw key", () => {
    process.env[KEY] = "raw-key-value"
    expect(pickSharedOpencodeKey()).not.toContain("raw-key-value")
  })

  it("selects by Math.random across all keys", () => {
    process.env[KEY] = "a,b,c"
    // Math.random in [0, 1/3) → index 0, [1/3, 2/3) → index 1, [2/3, 1) → index 2.
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(pickSharedOpencodeKey()).toBe(marker("a"))
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(pickSharedOpencodeKey()).toBe(marker("b"))
    vi.spyOn(Math, "random").mockReturnValue(0.9)
    expect(pickSharedOpencodeKey()).toBe(marker("c"))
  })

  it("spreads roughly evenly across all keys over many draws", () => {
    process.env[KEY] = "a,b,c"
    const counts: Record<string, number> = { [marker("a")]: 0, [marker("b")]: 0, [marker("c")]: 0 }
    for (let i = 0; i < 6000; i++) counts[pickSharedOpencodeKey()!]++
    // Each should land well within a generous band around 1/3 (2000).
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(1600)
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

describe("secret names", () => {
  it("derives a stable, valid Daytona secret name from the key", () => {
    const name = secretNameForKey("sk-some-key")
    expect(name).toMatch(/^opencode_[0-9a-f]{12}$/)
    expect(secretNameForKey("sk-some-key")).toBe(name)
    expect(secretNameForKey("sk-other-key")).not.toBe(name)
    expect(name).not.toContain("some-key")
  })

  it("maps each configured key to its secret and back", () => {
    process.env[KEY] = "k1, k2"
    expect(getSharedOpencodeSecretNames()).toEqual([secretNameForKey("k1"), secretNameForKey("k2")])
    expect(sharedOpencodeKeyForSecret(secretNameForKey("k2"))).toBe("k2")
    expect(sharedOpencodeKeyForSecret(secretNameForKey("removed"))).toBeUndefined()
  })

  it("round-trips a marker and rejects plain keys", () => {
    expect(parseSecretMarker(toSecretMarker("s1"))).toBe("s1")
    expect(parseSecretMarker("sk-plain-key")).toBeUndefined()
    expect(parseSecretMarker(toSecretMarker(""))).toBeUndefined()
    expect(parseSecretMarker(undefined)).toBeUndefined()
  })

  it("fingerprints a marker as the secret name", () => {
    expect(fingerprintKey(marker("k1"))).toBe(secretNameForKey("k1"))
  })
})
