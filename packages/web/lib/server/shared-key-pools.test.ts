/**
 * Unit tests for the shared provider key pools.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { toSecretMarker } from "@background-agents/sandbox-secrets"
import {
  SHARED_KEY_POOLS,
  fingerprintKey,
  getSharedKeys,
  getSharedSecretNames,
  hasSharedKey,
  pickSharedKey,
  secretNameForKey,
  sharedKeyForSecret,
  sharedPoolForCredential,
  sharedPoolForProvider,
  sharedPoolForSecret,
} from "./shared-key-pools"

const KEY = "OPENCODE_API_KEY"
const opencode = SHARED_KEY_POOLS.opencode
const gemini = SHARED_KEY_POOLS.gemini
const opencodeSecret = (key: string) => secretNameForKey(opencode, key)
const marker = (key: string) => toSecretMarker(opencodeSecret(key))

afterEach(() => {
  delete process.env[KEY]
  delete process.env.GEMINI_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

describe("getSharedKeys", () => {
  it("returns [] when the key is not configured", () => {
    expect(getSharedKeys(opencode)).toEqual([])
    expect(hasSharedKey(opencode)).toBe(false)
  })

  it("returns a single key when one is set", () => {
    process.env[KEY] = "primary"
    expect(getSharedKeys(opencode)).toEqual(["primary"])
    expect(hasSharedKey(opencode)).toBe(true)
  })

  it("splits comma-separated keys, trimming whitespace", () => {
    process.env[KEY] = " primary , secondary , third "
    expect(getSharedKeys(opencode)).toEqual(["primary", "secondary", "third"])
  })

  it("drops blank entries between commas", () => {
    process.env[KEY] = "primary,,   ,secondary"
    expect(getSharedKeys(opencode)).toEqual(["primary", "secondary"])
  })

  it("returns [] for an all-blank value", () => {
    process.env[KEY] = "  , ,  "
    expect(getSharedKeys(opencode)).toEqual([])
    expect(hasSharedKey(opencode)).toBe(false)
  })
})

describe("pickSharedKey", () => {
  it("returns undefined when nothing is configured", () => {
    expect(pickSharedKey(opencode)).toBeUndefined()
  })

  it("returns the single key's secret marker when only one is configured", () => {
    process.env[KEY] = "primary"
    expect(pickSharedKey(opencode)).toBe(marker("primary"))
  })

  it("never returns the raw key", () => {
    process.env[KEY] = "raw-key-value"
    expect(pickSharedKey(opencode)).not.toContain("raw-key-value")
  })

  it("returns the raw key when the pool's secrets are turned off, and only that pool's", () => {
    process.env[KEY] = "raw-key-value"
    process.env.GEMINI_API_KEY = "raw-gemini-key"
    process.env.DAYTONA_USER_KEY_SECRETS = "GEMINI_SHARED"
    expect(pickSharedKey(opencode)).toBe("raw-key-value")
    expect(pickSharedKey(gemini)).toBe(toSecretMarker(secretNameForKey(gemini, "raw-gemini-key")))
    process.env.DAYTONA_USER_KEY_SECRETS = "none"
    expect(pickSharedKey(gemini)).toBe("raw-gemini-key")
  })

  it("selects by Math.random across all keys", () => {
    process.env[KEY] = "a,b,c"
    // Math.random in [0, 1/3) → index 0, [1/3, 2/3) → index 1, [2/3, 1) → index 2.
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(pickSharedKey(opencode)).toBe(marker("a"))
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(pickSharedKey(opencode)).toBe(marker("b"))
    vi.spyOn(Math, "random").mockReturnValue(0.9)
    expect(pickSharedKey(opencode)).toBe(marker("c"))
  })

  it("spreads roughly evenly across all keys over many draws", () => {
    process.env[KEY] = "a,b,c"
    const counts: Record<string, number> = { [marker("a")]: 0, [marker("b")]: 0, [marker("c")]: 0 }
    for (let i = 0; i < 6000; i++) counts[pickSharedKey(opencode)!]++
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
    const name = opencodeSecret("sk-some-key")
    expect(name).toMatch(/^opencode_[0-9a-f]{12}$/)
    expect(opencodeSecret("sk-some-key")).toBe(name)
    expect(opencodeSecret("sk-other-key")).not.toBe(name)
    expect(name).not.toContain("some-key")
  })

  it("maps each configured key to its secret and back", () => {
    process.env[KEY] = "k1, k2"
    expect(getSharedSecretNames(opencode)).toEqual([opencodeSecret("k1"), opencodeSecret("k2")])
    expect(sharedKeyForSecret(opencodeSecret("k2"))).toBe("k2")
    expect(sharedKeyForSecret(opencodeSecret("removed"))).toBeUndefined()
  })

  it("fingerprints a marker as the secret name", () => {
    expect(fingerprintKey(marker("k1"))).toBe(opencodeSecret("k1"))
  })
})

describe("pools", () => {
  it("keeps each pool's keys and secrets apart", () => {
    process.env.OPENCODE_API_KEY = "same-key"
    process.env.GEMINI_API_KEY = "same-key, g2"
    const geminiName = secretNameForKey(gemini, "same-key")
    expect(geminiName).toMatch(/^gemini_[0-9a-f]{12}$/)
    expect(geminiName).not.toBe(opencodeSecret("same-key"))
    expect(getSharedKeys(gemini)).toEqual(["same-key", "g2"])
    expect(sharedPoolForSecret(geminiName)).toBe(gemini)
    expect(sharedKeyForSecret(geminiName)).toBe("same-key")
    expect(sharedKeyForSecret("anthropic_123")).toBeUndefined()
  })

  it("finds a pool by provider and by credential id", () => {
    expect(sharedPoolForProvider("gemini")).toBe(gemini)
    expect(sharedPoolForProvider("opencode")).toBe(opencode)
    expect(sharedPoolForProvider("anthropic")).toBeUndefined()
    expect(sharedPoolForProvider(undefined)).toBeUndefined()
    expect(sharedPoolForCredential("GEMINI_API_KEY")).toBe(gemini)
    expect(sharedPoolForCredential("ANTHROPIC_API_KEY")).toBeUndefined()
  })

  it("hands out Gemini keys as markers too", () => {
    process.env.GEMINI_API_KEY = "raw-gemini-key"
    expect(hasSharedKey(gemini)).toBe(true)
    expect(pickSharedKey(gemini)).toBe(toSecretMarker(secretNameForKey(gemini, "raw-gemini-key")))
  })
})
