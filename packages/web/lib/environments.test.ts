import { describe, it, expect, vi } from "vitest"

// Mock the prisma singleton: lib/db/prisma.ts constructs a PrismaClient at
// module scope and throws when DATABASE_URL is unset. The functions under
// test here are pure and never touch this mock.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import {
  decryptEnvironmentVariables,
  encryptEnvironmentVariables,
  resolveDomainAllowList,
  type ResolvedEnvironment,
} from "./environments"
import { encrypt } from "./db/encryption"
import { BASELINE_DOMAINS } from "@background-agents/common"

function env(overrides: Partial<ResolvedEnvironment> = {}): ResolvedEnvironment {
  return {
    id: "env_1",
    name: "Default",
    repo: "acme/app",
    isDefault: true,
    networkMode: "full",
    allowedDomains: [],
    variables: {},
    setupScript: null,
    ...overrides,
  }
}

describe("decryptEnvironmentVariables", () => {
  it("decrypts every stored value", () => {
    const stored = { API_KEY: encrypt("secret"), OTHER: encrypt("two") }
    expect(decryptEnvironmentVariables(stored)).toEqual({ API_KEY: "secret", OTHER: "two" })
  })

  it("returns an empty object for null, undefined, or a non-object", () => {
    expect(decryptEnvironmentVariables(null)).toEqual({})
    expect(decryptEnvironmentVariables(undefined)).toEqual({})
    expect(decryptEnvironmentVariables("nonsense")).toEqual({})
  })

  it("skips empty values rather than emitting empty strings", () => {
    expect(decryptEnvironmentVariables({ A: encrypt("x"), B: "" })).toEqual({ A: "x" })
  })
})

describe("encryptEnvironmentVariables", () => {
  it("round-trips through decrypt", () => {
    const out = encryptEnvironmentVariables({ TOKEN: "abc" })
    expect(out.TOKEN).not.toBe("abc")
    expect(decryptEnvironmentVariables(out)).toEqual({ TOKEN: "abc" })
  })

  it("trims keys and drops blank ones", () => {
    const out = encryptEnvironmentVariables({ "  A  ": "1", "": "2", "   ": "3" })
    expect(Object.keys(out)).toEqual(["A"])
  })
})

describe("resolveDomainAllowList", () => {
  it("returns undefined in full mode so Daytona applies no restriction", () => {
    expect(resolveDomainAllowList(env({ networkMode: "full" }))).toBeUndefined()
  })

  it("returns undefined in full mode even when domains are listed", () => {
    expect(
      resolveDomainAllowList(env({ networkMode: "full", allowedDomains: ["example.com"] }))
    ).toBeUndefined()
  })

  it("joins the baseline with the user's domains in restricted mode", () => {
    const result = resolveDomainAllowList(
      env({ networkMode: "restricted", allowedDomains: ["example.com", "*.internal.dev"] })
    )
    const parts = result!.split(",")
    for (const baseline of BASELINE_DOMAINS) expect(parts).toContain(baseline)
    expect(parts).toContain("example.com")
    expect(parts).toContain("*.internal.dev")
  })

  it("deduplicates a user domain that is already in the baseline", () => {
    const result = resolveDomainAllowList(
      env({ networkMode: "restricted", allowedDomains: ["github.com"] })
    )
    const occurrences = result!.split(",").filter((d) => d === "github.com")
    expect(occurrences).toHaveLength(1)
  })
})
