/**
 * Unit tests for putting users' chat and repo env vars behind Daytona secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const daytonaSecret = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@daytonaio/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@daytonaio/sdk")>()),
  Daytona: class {
    secret = daytonaSecret
  },
}))

import { SECRET_NAME_PATTERN } from "@background-agents/sandbox-secrets"
import { decrypt } from "@/lib/db/encryption"
import {
  MAX_SECRET_ENV_VARS,
  chatEnvScope,
  decodeEnvVars,
  encodeEnvVars,
  envVarSecretPrefix,
  envVarSecretSpec,
  envVarSecretsEnabled,
  envVarSecretsOf,
  hasSecretEnvVars,
  parseEnvVarSet,
  repoEnvScope,
  syncEnvVarSecrets,
  type EnvVarSecret,
} from "./env-var-secrets"
import { userKeySecretPrefix } from "./user-key-secrets"

const secret = (fields: Partial<EnvVarSecret> = {}): EnvVarSecret => ({
  key: "STRIPE_KEY",
  value: "sk_live_x",
  hosts: ["api.stripe.com"],
  scope: chatEnvScope("c1"),
  ...fields,
})

let counter = 0

beforeEach(() => {
  process.env.DAYTONA_API_KEY = "dtn-test"
  process.env.DAYTONA_USER_KEY_SECRETS = "ENV_VARS"
  daytonaSecret.list.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  daytonaSecret.create.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: "p" }))
  daytonaSecret.delete.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.DAYTONA_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

describe("envVarSecretsEnabled", () => {
  it("is on for ENV_VARS or all, off otherwise", () => {
    expect(envVarSecretsEnabled()).toBe(true)
    process.env.DAYTONA_USER_KEY_SECRETS = "all"
    expect(envVarSecretsEnabled()).toBe(true)
    process.env.DAYTONA_USER_KEY_SECRETS = "ANTHROPIC_API_KEY,CUSTOM_ENDPOINTS"
    expect(envVarSecretsEnabled()).toBe(false)
  })
})

describe("encodeEnvVars / decodeEnvVars", () => {
  it("round-trips plain and secret vars, encrypting every value", () => {
    const set = { values: { PORT: "3000", STRIPE_KEY: "sk_live_x" }, secretHosts: { STRIPE_KEY: ["api.stripe.com"] } }
    const stored = encodeEnvVars(set)
    expect(typeof stored.PORT).toBe("string")
    expect(stored.PORT).not.toBe("3000")
    expect(stored.STRIPE_KEY).toMatchObject({ hosts: ["api.stripe.com"] })
    expect(JSON.stringify(stored)).not.toContain("sk_live_x")
    expect(decodeEnvVars(stored)).toEqual(set)
  })

  it("reads the format from before secrets, and nothing", () => {
    expect(decodeEnvVars({ PORT: encodeEnvVars({ values: { PORT: "3000" }, secretHosts: {} }).PORT })).toEqual({
      values: { PORT: "3000" },
      secretHosts: {},
    })
    expect(decodeEnvVars(null)).toEqual({ values: {}, secretHosts: {} })
  })

  it("tells whether a stored scope has a secret var", () => {
    expect(hasSecretEnvVars(encodeEnvVars({ values: { K: "v" }, secretHosts: { K: ["a.example.com"] } }))).toBe(true)
    expect(hasSecretEnvVars(encodeEnvVars({ values: { K: "v" }, secretHosts: {} }))).toBe(false)
    expect(hasSecretEnvVars(null)).toBe(false)
  })

  it("stores a secret's value encrypted like any other", () => {
    const stored = encodeEnvVars({ values: { K: "v" }, secretHosts: { K: ["a.example.com"] } })
    expect(decrypt((stored.K as { v: string }).v)).toBe("v")
  })
})

describe("parseEnvVarSet", () => {
  it("trims names, normalises hosts and ignores hosts for unknown vars", () => {
    expect(
      parseEnvVarSet(
        { " STRIPE_KEY ": "sk", PORT: "3000", "": "x" },
        { STRIPE_KEY: [" API.Stripe.com ", "api.stripe.com", ""], GONE: ["a.example.com"] }
      )
    ).toEqual({ values: { STRIPE_KEY: "sk", PORT: "3000" }, secretHosts: { STRIPE_KEY: ["api.stripe.com"] } })
  })

  it("accepts no secret hosts at all", () => {
    expect(parseEnvVarSet({ PORT: "3000" }, undefined)).toEqual({ values: { PORT: "3000" }, secretHosts: {} })
  })

  it("rejects what can't be a secret", () => {
    const bad: [unknown, unknown, RegExp][] = [
      [null, undefined, /Invalid environmentVariables/],
      [{ K: "v" }, "x", /Invalid secretEnvironmentVariables/],
      [{ K: "v" }, { K: [] }, /at least one host/],
      [{ K: "v" }, { K: "api.example.com" }, /Invalid hosts/],
      [{ K: "v" }, { K: ["https://api.example.com"] }, /isn't a host name/],
      [{ K: "v" }, { K: ["*.com"] }, /isn't a host name/],
      [{ K: "v" }, { K: ["localhost"] }, /isn't a host name/],
      [{ "MY-KEY": "v" }, { "MY-KEY": ["a.example.com"] }, /letters, digits and underscores/],
      [{ SESSION_RELAY_TOKEN: "v" }, { SESSION_RELAY_TOKEN: ["a.example.com"] }, /reserved/],
      [{ USER_KEY_X: "v" }, { USER_KEY_X: ["a.example.com"] }, /reserved/],
      [{ https_proxy: "v" }, { https_proxy: ["a.example.com"] }, /reserved/],
    ]
    for (const [values, hosts, message] of bad) {
      expect(parseEnvVarSet(values, hosts)).toMatch(message)
    }
  })

  it("caps secret vars per scope", () => {
    const values = Object.fromEntries(Array.from({ length: MAX_SECRET_ENV_VARS + 1 }, (_, i) => [`K${i}`, "v"]))
    const hosts = Object.fromEntries(Object.keys(values).map((k) => [k, ["a.example.com"]]))
    expect(parseEnvVarSet(values, hosts)).toMatch(/At most/)
  })
})

describe("envVarSecretSpec", () => {
  it("names the secret after the user, scope and var, and allows only its hosts", () => {
    const spec = envVarSecretSpec("user-1", secret())
    expect(spec.name).toMatch(SECRET_NAME_PATTERN)
    expect(spec.name.startsWith(envVarSecretPrefix("user-1", chatEnvScope("c1")))).toBe(true)
    expect(spec.name.startsWith(userKeySecretPrefix("user-1"))).toBe(true)
    expect(spec.name).not.toContain("sk_live_x")
    expect(spec.hosts).toEqual(["api.stripe.com"])
    expect(spec.value()).toBe("sk_live_x")
  })

  it("gets a new name when the value, hosts, name or scope change", () => {
    const names = new Set(
      [
        secret(),
        secret({ value: "sk_live_y" }),
        secret({ hosts: ["api.stripe.com", "files.stripe.com"] }),
        secret({ key: "STRIPE_KEY_2" }),
        secret({ scope: repoEnvScope("o/r") }),
      ].map((s) => envVarSecretSpec("user-1", s).name)
    )
    expect(names.size).toBe(5)
  })
})

describe("envVarSecretsOf", () => {
  it("lists the scope's secret vars, skipping empty values", () => {
    expect(
      envVarSecretsOf(
        { values: { A: "a", B: "", C: "c" }, secretHosts: { A: ["a.example.com"], B: ["b.example.com"] } },
        "chat:c1"
      )
    ).toEqual([{ key: "A", value: "a", hosts: ["a.example.com"], scope: "chat:c1" }])
  })
})

describe("syncEnvVarSecrets", () => {
  it("creates the scope's secrets and deletes its others", async () => {
    const userId = `user-sync-${counter++}`
    const scope = chatEnvScope("c1")
    const spec = envVarSecretSpec(userId, secret())
    daytonaSecret.list
      .mockResolvedValueOnce({ items: [] }) // ensure: not there yet
      .mockResolvedValueOnce({
        items: [
          { id: "1", name: `${envVarSecretPrefix(userId, scope)}stale` },
          { id: "2", name: spec.name },
        ],
        nextCursor: null,
      })
    await syncEnvVarSecrets(userId, scope, {
      values: { STRIPE_KEY: "sk_live_x", PORT: "3000" },
      secretHosts: { STRIPE_KEY: ["api.stripe.com"] },
    })
    expect(daytonaSecret.create).toHaveBeenCalledTimes(1)
    expect(daytonaSecret.create).toHaveBeenCalledWith(expect.objectContaining({ name: spec.name, hosts: ["api.stripe.com"] }))
    expect(daytonaSecret.delete.mock.calls).toEqual([["1"]])
  })

  it("does nothing while env var secrets are off", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "ANTHROPIC_API_KEY"
    await syncEnvVarSecrets("user-x", chatEnvScope("c1"), { values: { K: "v" }, secretHosts: { K: ["a.example.com"] } })
    expect(daytonaSecret.list).not.toHaveBeenCalled()
  })

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    daytonaSecret.list.mockRejectedValue(new Error("403"))
    await expect(
      syncEnvVarSecrets(`user-sync-${counter++}`, chatEnvScope("c1"), {
        values: { K: "v" },
        secretHosts: { K: ["a.example.com"] },
      })
    ).resolves.toBeUndefined()
  })
})
