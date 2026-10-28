/**
 * Unit tests for putting custom endpoint credentials behind Daytona secrets.
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

import {
  ENDPOINT_TYPE_TO_AGENT,
  buildEndpointEnv,
  type CustomEndpoint,
  type CustomEndpointType,
} from "@background-agents/common"
import { SECRET_NAME_PATTERN } from "@background-agents/sandbox-secrets"
import {
  endpointCredentials,
  endpointSecretHost,
  endpointSecretPrefix,
  endpointSecretSpec,
  endpointSecretsEnabled,
  syncEndpointSecrets,
} from "./endpoint-secrets"
import { applyTurnSecretsToEnv, planTurnSecrets } from "./turn-secrets"

const endpoint = (fields: Partial<CustomEndpoint>): CustomEndpoint => ({
  id: "e1",
  name: "proxy",
  type: "anthropic",
  baseUrl: "https://proxy.example.com/v1",
  model: "m",
  headers: "",
  ...fields,
})

let counter = 0

beforeEach(() => {
  process.env.DAYTONA_API_KEY = "dtn-test"
  process.env.DAYTONA_USER_KEY_SECRETS = "CUSTOM_ENDPOINTS"
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

describe("endpointSecretsEnabled", () => {
  it("is on for CUSTOM_ENDPOINTS or all, off otherwise", () => {
    expect(endpointSecretsEnabled()).toBe(true)
    process.env.DAYTONA_USER_KEY_SECRETS = "all"
    expect(endpointSecretsEnabled()).toBe(true)
    process.env.DAYTONA_USER_KEY_SECRETS = "ANTHROPIC_API_KEY"
    expect(endpointSecretsEnabled()).toBe(false)
    delete process.env.DAYTONA_USER_KEY_SECRETS
    expect(endpointSecretsEnabled()).toBe(false)
  })
})

describe("endpointSecretHost", () => {
  it("is the host of a plain HTTPS base URL", () => {
    expect(endpointSecretHost("https://proxy.example.com/v1")).toBe("proxy.example.com")
    expect(endpointSecretHost("https://proxy.example.com:443/v1")).toBe("proxy.example.com")
  })

  it("is undefined where the proxy can't swap: HTTP, another port, or no URL", () => {
    expect(endpointSecretHost("http://proxy.example.com")).toBeUndefined()
    expect(endpointSecretHost("https://proxy.example.com:8443")).toBeUndefined()
    expect(endpointSecretHost("not a url")).toBeUndefined()
  })
})

describe("endpointCredentials", () => {
  it("takes credential-looking headers, Bearer stripped, and skips the rest", () => {
    const headers = [
      "Authorization: Bearer tok-1",
      "x-api-key: key-2",
      "api-key: key-3",
      "X-Auth-Token: key-4",
      "CF-Access-Client-Secret: key-5",
      "OpenAI-Organization: org-x",
      "anthropic-beta: tools",
      "# x-api-key: commented-out",
      "x-api-key: key-2",
      "x-api-key:",
    ].join("\n")
    expect(endpointCredentials(endpoint({ headers }))).toEqual(["tok-1", "key-2", "key-3", "key-4", "key-5"])
  })
})

describe("endpointSecretSpec", () => {
  it("names the secret after the user, host and value, and allows only that host", () => {
    const spec = endpointSecretSpec("user-1", "proxy.example.com", "tok-secret")
    expect(spec.name).toMatch(SECRET_NAME_PATTERN)
    expect(spec.name.startsWith(endpointSecretPrefix("user-1"))).toBe(true)
    expect(spec.name).not.toContain("tok-secret")
    expect(spec.hosts).toEqual(["proxy.example.com"])
    expect(spec.value()).toBe("tok-secret")
    expect(endpointSecretSpec("user-1", "other.example.com", "tok-secret").name).not.toBe(spec.name)
  })
})

describe("syncEndpointSecrets", () => {
  it("creates what the saved endpoints need and deletes the user's other endpoint secrets", async () => {
    const userId = `user-sync-${counter++}`
    const spec = endpointSecretSpec(userId, "proxy.example.com", "tok-1")
    daytonaSecret.list
      .mockResolvedValueOnce({ items: [] }) // ensure: not there yet
      .mockResolvedValueOnce({
        items: [
          { id: "1", name: `${endpointSecretPrefix(userId)}stale` },
          { id: "2", name: spec.name },
        ],
        nextCursor: null,
      })
    await syncEndpointSecrets(userId, [
      endpoint({ headers: "Authorization: Bearer tok-1" }),
      endpoint({ id: "e2", baseUrl: "http://plain.example.com", headers: "x-api-key: skipped" }),
    ])
    expect(daytonaSecret.create).toHaveBeenCalledTimes(1)
    expect(daytonaSecret.create).toHaveBeenCalledWith(expect.objectContaining({ name: spec.name, hosts: ["proxy.example.com"] }))
    expect(daytonaSecret.delete.mock.calls).toEqual([["1"]])
  })

  it("does nothing while endpoint secrets are off", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "OPENAI_API_KEY"
    await syncEndpointSecrets("user-x", [endpoint({ headers: "x-api-key: k" })])
    expect(daytonaSecret.list).not.toHaveBeenCalled()
  })

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    daytonaSecret.list.mockRejectedValue(new Error("403"))
    await expect(
      syncEndpointSecrets(`user-sync-${counter++}`, [endpoint({ headers: "x-api-key: k" })])
    ).resolves.toBeUndefined()
  })
})

describe("every endpoint type", () => {
  const headers = "Authorization: Bearer raw-token-value\nx-api-key: raw-api-key-value\nOpenAI-Organization: org-x"

  for (const type of Object.keys(ENDPOINT_TYPE_TO_AGENT) as CustomEndpointType[]) {
    it(`${type}: no credential reaches the agent raw`, () => {
      const ep = endpoint({ type, headers })
      const model = "endpoint:e1"
      const agent = ENDPOINT_TYPE_TO_AGENT[type]
      const planned = planTurnSecrets({ userId: "user-1", agent, model, credentials: {}, endpoints: [ep] })
      const env = buildEndpointEnv(ep)
      applyTurnSecretsToEnv(env, planned.map((s) => ({ ...s, placeholder: `dtn_secret_${s.name}` })))
      for (const value of Object.values(env)) {
        expect(value).not.toContain("raw-token-value")
        expect(value).not.toContain("raw-api-key-value")
      }
      expect(Object.values(env).join("\n")).not.toContain("raw-")
    })
  }
})
