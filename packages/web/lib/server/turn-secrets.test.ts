/**
 * Unit tests for the set of Daytona secrets a turn mounts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { toSecretMarker } from "@background-agents/sandbox-secrets"
import { agentModels, getEnvForModel, type Agent, type CredentialId, type CustomEndpoint } from "@background-agents/common"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import { USER_KEY_PROVIDERS, userKeySecretName, userKeySecretSpec } from "./user-key-secrets"
import {
  TURN_SECRETS_LABEL as LABEL,
  applyTurnSecretsToEnv,
  ensureTurnSecrets,
  mountTurnSecrets,
  planTurnSecrets,
  poolSecretOf,
  releaseTurnSecrets,
  turnSecretsCreateParams,
  type ReadyTurnSecret,
  type TurnSecret,
} from "./turn-secrets"

function fakeSandbox(labels: Record<string, string> = {}) {
  const sandbox = {
    id: "sb-1",
    labels: { ...labels },
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    setLabels: vi.fn().mockImplementation(async (next: Record<string, string>) => {
      sandbox.labels = next
      return next
    }),
  }
  return sandbox
}

const asSandbox = (sandbox: ReturnType<typeof fakeSandbox>) => sandbox as unknown as DaytonaSandbox

const placeholderFor = (name: string) => `dtn_secret_${name}`

function fakeDaytona() {
  const secret = {
    list: vi.fn().mockResolvedValue({ items: [] }),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
  }
  return { secret, daytona: { secret } as unknown as Daytona }
}

const USER = "user-1"
const SECRET_1 = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-1")
const SECRET_2 = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-2")
const GEMINI_SECRET = secretNameForKey(SHARED_KEY_POOLS.gemini, "gemini-key")

let counter = 0

beforeEach(() => {
  process.env.OPENCODE_API_KEY = "key-1,key-2"
  process.env.GEMINI_API_KEY = "gemini-key"
  process.env.DAYTONA_USER_KEY_SECRETS = "all"
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.OPENCODE_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

function ready(secret: Partial<TurnSecret> & Pick<TurnSecret, "name" | "mountEnv">): ReadyTurnSecret {
  return {
    kind: "pool",
    envValue: toSecretMarker(secret.name),
    envKeys: ["OPENCODE_API_KEY"],
    placeholder: placeholderFor(secret.name),
    ...secret,
  }
}

const POOL_1 = ready({ name: SECRET_1, mountEnv: "SESSION_RELAY_TOKEN" })

function ownKey(credential: CredentialId, value: string, extra: Partial<TurnSecret> = {}): ReadyTurnSecret {
  const spec = userKeySecretSpec(USER, credential, value)
  return {
    kind: "user",
    name: spec.name,
    mountEnv: `USER_KEY_${credential}`,
    envValue: value,
    envKeys: [credential],
    spec,
    bypassEnv: USER_KEY_PROVIDERS[credential]?.baseUrlEnv,
    placeholder: placeholderFor(spec.name),
    ...extra,
  }
}

const endpoint = (fields: Partial<CustomEndpoint>): CustomEndpoint => ({
  id: "e1",
  name: "proxy",
  type: "anthropic",
  baseUrl: "https://proxy.example.com/v1",
  model: "m",
  headers: "",
  ...fields,
})

describe("planTurnSecrets", () => {
  it("plans the pool secret a shared run draws on", () => {
    const marker = toSecretMarker(SECRET_1)
    expect(
      planTurnSecrets({
        userId: USER,
        agent: "opencode",
        model: "opencode-go/mimo-v2.5-pro",
        credentials: { OPENCODE_API_KEY: marker },
      })
    ).toEqual([
      { kind: "pool", name: SECRET_1, mountEnv: "SESSION_RELAY_TOKEN", envValue: marker, envKeys: ["OPENCODE_API_KEY"] },
    ])
  })

  it("finds every env var a key is copied into", () => {
    const marker = toSecretMarker(GEMINI_SECRET)
    const [pool] = planTurnSecrets({
      userId: USER,
      agent: "gemini",
      model: "gemini-2.5-flash",
      credentials: { GEMINI_API_KEY: marker },
    })
    expect(pool.envKeys).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"])
  })

  it("plans the user's own key the agent would be given", () => {
    expect(
      planTurnSecrets({ userId: USER, agent: "codex", model: "gpt-6.1-sol", credentials: { OPENAI_API_KEY: "sk-own" } })
    ).toMatchObject([
      {
        kind: "user",
        name: userKeySecretName(USER, "OPENAI_API_KEY", "sk-own"),
        mountEnv: "USER_KEY_OPENAI_API_KEY",
        envValue: "sk-own",
        envKeys: ["OPENAI_API_KEY"],
        spec: { hosts: ["api.openai.com"] },
        bypassEnv: USER_KEY_PROVIDERS.OPENAI_API_KEY!.baseUrlEnv,
      },
    ])
  })

  it("plans every key Droid is handed, pool and own alike", () => {
    const secrets = planTurnSecrets({
      userId: USER,
      agent: "droid",
      model: "gemini-2.5-flash",
      credentials: {
        GEMINI_API_KEY: toSecretMarker(GEMINI_SECRET),
        ANTHROPIC_API_KEY: "sk-ant-own",
        FACTORY_API_KEY: "fk-own",
      },
    })
    expect(secrets.map((s) => [s.kind, s.envKeys[0]])).toEqual([
      ["pool", "GEMINI_API_KEY"],
      ["user", "FACTORY_API_KEY"],
      ["user", "ANTHROPIC_API_KEY"],
    ])
  })

  it("plans nothing for keys the agent isn't given, or that aren't enabled", () => {
    // Claude Code prefers the subscription, so the API key never reaches it.
    expect(
      planTurnSecrets({
        userId: USER,
        agent: "claude-code",
        model: "sonnet",
        credentials: { CLAUDE_CODE_CREDENTIALS: "{}", ANTHROPIC_API_KEY: "sk-ant-own" },
      })
    ).toEqual([])
    // Copilot's CLI rejects a placeholder.
    expect(
      planTurnSecrets({ userId: USER, agent: "copilot", model: "auto", credentials: { COPILOT_GITHUB_TOKEN: "ghp_x" } })
    ).toEqual([])
    process.env.DAYTONA_USER_KEY_SECRETS = "KIMI_API_KEY"
    expect(
      planTurnSecrets({ userId: USER, agent: "codex", model: "gpt-6.1-sol", credentials: { OPENAI_API_KEY: "sk-own" } })
    ).toEqual([])
    expect(
      planTurnSecrets({ userId: USER, agent: "kimi", model: "kimi-k3", credentials: { KIMI_API_KEY: "kk" } })
    ).toHaveLength(1)
  })

  it("plans one secret per endpoint credential, on its host, covering every var it appears in", () => {
    const ep = endpoint({
      type: "codex",
      headers: "Authorization: Bearer tok-1\nx-api-key: key-2\nOpenAI-Organization: org-x",
    })
    const secrets = planTurnSecrets({
      userId: USER,
      agent: "codex",
      model: "endpoint:e1",
      credentials: { OPENAI_API_KEY: "sk-own" },
      endpoints: [ep],
    })
    expect(secrets).toMatchObject([
      {
        kind: "endpoint",
        mountEnv: "ENDPOINT_SECRET_1",
        envValue: "tok-1",
        envKeys: ["CUSTOM_CODEX_HEADERS", "CUSTOM_CODEX_AUTHORIZATION"],
        spec: { hosts: ["proxy.example.com"] },
      },
      { kind: "endpoint", mountEnv: "ENDPOINT_SECRET_2", envValue: "key-2", envKeys: ["CUSTOM_CODEX_HEADERS"] },
    ])
  })

  it("plans no endpoint secrets when they're off, or the endpoint isn't plain HTTPS", () => {
    const run = (ep: CustomEndpoint) =>
      planTurnSecrets({ userId: USER, agent: "claude-code", model: "endpoint:e1", credentials: {}, endpoints: [ep] })
    const headers = "x-api-key: sk-proxy"
    expect(run(endpoint({ headers, baseUrl: "http://proxy.example.com" }))).toEqual([])
    expect(run(endpoint({ headers, baseUrl: "https://proxy.example.com:8443" }))).toEqual([])
    expect(run(endpoint({ headers }))).toHaveLength(1)
    // The endpoint's x-api-key lands in ANTHROPIC_API_KEY, but it isn't the user's Anthropic key.
    process.env.DAYTONA_USER_KEY_SECRETS = "ANTHROPIC_API_KEY"
    expect(run(endpoint({ headers }))).toEqual([])
  })
})

describe("ensureTurnSecrets", () => {
  it("resolves every secret's placeholder, creating user secrets from their spec", async () => {
    const { secret, daytona } = fakeDaytona()
    const key = `sk-ant-${counter++}`
    const { placeholder: _placeholder, ...planned } = ownKey("ANTHROPIC_API_KEY", key)
    expect(await ensureTurnSecrets(daytona, [planned])).toEqual([{ ...planned, placeholder: placeholderFor(planned.name) }])
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: planned.name, value: key, hosts: ["api.anthropic.com"] })
    )
  })

  it("leaves out a user secret that fails, so the agent gets the value as before", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { secret, daytona } = fakeDaytona()
    secret.list.mockRejectedValue(new Error("403"))
    await expect(ensureTurnSecrets(daytona, [ownKey("OPENAI_API_KEY", `sk-${counter++}`)])).resolves.toEqual([])
  })

  it("fails the turn when a pool secret fails: the shared key never falls back", async () => {
    process.env.OPENCODE_API_KEY = `pool-${counter++}`
    const name = secretNameForKey(SHARED_KEY_POOLS.opencode, process.env.OPENCODE_API_KEY)
    const { secret, daytona } = fakeDaytona()
    secret.list.mockRejectedValue(new Error("403"))
    const planned: TurnSecret[] = [
      { kind: "pool", name, mountEnv: "SESSION_RELAY_TOKEN", envValue: toSecretMarker(name), envKeys: ["OPENCODE_API_KEY"] },
    ]
    await expect(ensureTurnSecrets(daytona, planned)).rejects.toThrow("403")
  })
})

describe("mountTurnSecrets", () => {
  it("mounts and restarts once a sandbox created without secrets", async () => {
    const sandbox = fakeSandbox({ repo: "o/r" })
    expect(await mountTurnSecrets(asSandbox(sandbox), [POOL_1])).toEqual({
      mounts: { SESSION_RELAY_TOKEN: SECRET_1 },
      readyAt: 0,
    })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).toHaveBeenCalledTimes(1)
    expect(sandbox.start).toHaveBeenCalledTimes(1)
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
  })

  it("makes no API call when the set is already mounted", async () => {
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    await expect(mountTurnSecrets(asSandbox(sandbox), [POOL_1])).resolves.toMatchObject({ readyAt: 0 })
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("remounts a detached sandbox without a restart, but waits for propagation", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    const before = Date.now()
    const mounted = await mountTurnSecrets(asSandbox(sandbox), [POOL_1])
    expect(mounted.readyAt).toBeGreaterThan(before)
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })

  it("remounts a sandbox still labelled from the old OPENCODE_API_KEY mount", async () => {
    // Pre-rename label: a bare secret name, mounted under OPENCODE_API_KEY.
    const sandbox = fakeSandbox({ [LABEL]: SECRET_1 })
    await mountTurnSecrets(asSandbox(sandbox), [POOL_1])
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({ SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[LABEL]).toBe(`SESSION_RELAY_TOKEN:${SECRET_1}`)
  })

  it("mounts the whole set, replacing whatever else is mounted", async () => {
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_2}` })
    const own = ownKey("ANTHROPIC_API_KEY", "sk-ant-own")
    const gemini = ready({ name: GEMINI_SECRET, mountEnv: "SESSION_RELAY_TOKEN_GEMINI", envKeys: ["GEMINI_API_KEY"] })
    await mountTurnSecrets(asSandbox(sandbox), [gemini, own])
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({
      SESSION_RELAY_TOKEN_GEMINI: GEMINI_SECRET,
      USER_KEY_ANTHROPIC_API_KEY: own.name,
    })
  })

  it("with nothing to mount, detaches leftovers but never restarts a secret-less sandbox", async () => {
    const leftover = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    await mountTurnSecrets(asSandbox(leftover), [])
    expect(leftover.updateSecrets).toHaveBeenCalledWith({})

    const plain = fakeSandbox({ repo: "o/r" })
    await mountTurnSecrets(asSandbox(plain), [])
    expect(plain.updateSecrets).not.toHaveBeenCalled()
    expect(plain.stop).not.toHaveBeenCalled()
  })

  // The label is written last, and releaseTurnSecrets keys off it, so a
  // mount that throws partway has to detach itself — otherwise it strands a
  // live placeholder nothing will ever clean up.
  it("detaches the secrets again when the enabling restart fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))
    await expect(mountTurnSecrets(asSandbox(sandbox), [POOL_1])).rejects.toThrow("start timed out")
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
    expect(sandbox.labels[LABEL]).toBeUndefined()
  })

  it("detaches the secrets again when the label write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    sandbox.setLabels.mockRejectedValueOnce(new Error("labels rejected"))
    await expect(mountTurnSecrets(asSandbox(sandbox), [POOL_1])).rejects.toThrow("labels rejected")
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({})
  })

  it("still surfaces the original failure when the rollback detach also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox()
    sandbox.start.mockRejectedValueOnce(new Error("start timed out"))
    sandbox.updateSecrets.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("gone"))
    await expect(mountTurnSecrets(asSandbox(sandbox), [POOL_1])).rejects.toThrow("start timed out")
  })
})

describe("releaseTurnSecrets", () => {
  it("detaches the mounted set and marks the sandbox detached", async () => {
    const sandbox = fakeSandbox({ repo: "o/r", [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    await releaseTurnSecrets(asSandbox(sandbox))
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({})
    expect(sandbox.labels).toEqual({ repo: "o/r", [LABEL]: "none" })
  })

  it("makes no API call when nothing is mounted", async () => {
    for (const labels of [{}, { [LABEL]: "none" }] as Record<string, string>[]) {
      const sandbox = fakeSandbox(labels)
      await releaseTurnSecrets(asSandbox(sandbox))
      expect(sandbox.updateSecrets).not.toHaveBeenCalled()
    }
  })

  it("never throws when the detach fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await expect(releaseTurnSecrets(asSandbox(sandbox))).resolves.toBeUndefined()
  })

  // A "mounted" label with nothing mounted would make the next turn skip the
  // attach and run keyless, so the label must never get ahead of the detach.
  it("keeps the mounted label when the detach fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const mounted = { [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` }
    const sandbox = fakeSandbox(mounted)
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    await releaseTurnSecrets(asSandbox(sandbox))
    expect(sandbox.labels).toEqual(mounted)
  })

  it("leaves the secrets mounted when the label write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.setLabels.mockRejectedValueOnce(new Error("boom"))
    await releaseTurnSecrets(asSandbox(sandbox))
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("re-attaches on the next mount when the label was flipped but the detach failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` })
    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    sandbox.setLabels
      .mockImplementationOnce(async (next: Record<string, string>) => (sandbox.labels = next))
      .mockRejectedValueOnce(new Error("restore failed"))
    await releaseTurnSecrets(asSandbox(sandbox))
    expect(sandbox.labels[LABEL]).toBe("none")

    await mountTurnSecrets(asSandbox(sandbox), [ready({ name: SECRET_2, mountEnv: "SESSION_RELAY_TOKEN" })])
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ SESSION_RELAY_TOKEN: SECRET_2 })
    expect(sandbox.stop).not.toHaveBeenCalled()
  })
})

describe("applyTurnSecretsToEnv", () => {
  const gemini = ready({
    name: GEMINI_SECRET,
    mountEnv: "SESSION_RELAY_TOKEN_GEMINI",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  })
  const own = ownKey("ANTHROPIC_API_KEY", "sk-ant-own")

  it("hands the agent placeholders in place of pool markers and the user's own keys", () => {
    const env: Record<string, string> = {
      OPENCODE_API_KEY: toSecretMarker(SECRET_1),
      ANTHROPIC_API_KEY: "sk-ant-own",
      X: "1",
    }
    applyTurnSecretsToEnv(env, [POOL_1, own])
    expect(env).toEqual({ OPENCODE_API_KEY: POOL_1.placeholder, ANTHROPIC_API_KEY: own.placeholder, X: "1" })
  })

  it("covers aliases of the same key", () => {
    const marker = toSecretMarker(GEMINI_SECRET)
    const env: Record<string, string> = { GEMINI_API_KEY: marker, GOOGLE_API_KEY: marker }
    applyTurnSecretsToEnv(env, [gemini])
    expect(env).toEqual({ GEMINI_API_KEY: gemini.placeholder, GOOGLE_API_KEY: gemini.placeholder })
  })

  // Droid is handed every provider key it might use, whatever the model.
  it("drops pool markers that no mounted secret backs", () => {
    const env: Record<string, string> = {
      GEMINI_API_KEY: toSecretMarker(GEMINI_SECRET),
      OPENCODE_API_KEY: toSecretMarker(SECRET_1),
      ANTHROPIC_API_KEY: "sk-ant-own",
    }
    applyTurnSecretsToEnv(env, [])
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-own" })
  })

  it("leaves a value the user set themselves untouched", () => {
    const env = { ANTHROPIC_API_KEY: "a-different-key", OPENCODE_API_KEY: "users-own-key" }
    applyTurnSecretsToEnv(env, [own])
    expect(env).toEqual({ ANTHROPIC_API_KEY: "a-different-key", OPENCODE_API_KEY: "users-own-key" })
  })

  it("keeps the user's own key when the env points its provider at another server", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-own", ANTHROPIC_BASE_URL: "https://proxy.example.com" }
    applyTurnSecretsToEnv(env, [own])
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-own")
  })

  it("swaps an endpoint credential inside header blobs, leaving the other headers", () => {
    const secret = ready({
      kind: "endpoint",
      name: "u_x_ep_1",
      mountEnv: "ENDPOINT_SECRET_1",
      envValue: "tok-1",
      envKeys: ["CUSTOM_CODEX_HEADERS", "CUSTOM_CODEX_AUTHORIZATION"],
    })
    const env: Record<string, string> = {
      CUSTOM_CODEX_BASE_URL: "https://proxy.example.com/v1",
      CUSTOM_CODEX_HEADERS: "Authorization: Bearer tok-1\nOpenAI-Organization: org-x",
      CUSTOM_CODEX_AUTHORIZATION: "Bearer tok-1",
    }
    applyTurnSecretsToEnv(env, [secret])
    expect(env).toEqual({
      CUSTOM_CODEX_BASE_URL: "https://proxy.example.com/v1",
      CUSTOM_CODEX_HEADERS: `Authorization: Bearer ${secret.placeholder}\nOpenAI-Organization: org-x`,
      CUSTOM_CODEX_AUTHORIZATION: `Bearer ${secret.placeholder}`,
    })
  })
})

describe("turnSecretsCreateParams", () => {
  it("mounts the set from the start and labels the sandbox with it", () => {
    expect(turnSecretsCreateParams([POOL_1])).toEqual({
      secrets: { SESSION_RELAY_TOKEN: SECRET_1 },
      labels: { [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}` },
    })
  })

  it("adds nothing to a sandbox that needs no secrets", () => {
    expect(turnSecretsCreateParams([])).toBeUndefined()
  })
})

describe("poolSecretOf", () => {
  it("names the pool secret, if any", () => {
    const own = ownKey("OPENAI_API_KEY", "sk-own")
    expect(poolSecretOf([own, POOL_1])).toBe(SECRET_1)
    expect(poolSecretOf([own])).toBeUndefined()
  })
})

describe("every agent and model", () => {
  // Every user key a provider entry covers, each with a distinct raw value.
  const ownKeys = Object.fromEntries(Object.keys(USER_KEY_PROVIDERS).map((id) => [id, `raw-${id}-value`]))

  for (const [agent, models] of Object.entries(agentModels)) {
    for (const { value: model } of models) {
      it(`${agent} ${model}: no enabled user key reaches the agent raw`, () => {
        const credentials = { ...ownKeys, COPILOT_GITHUB_TOKEN: "ghp_raw" }
        const planned = planTurnSecrets({ userId: USER, agent: agent as Agent, model, credentials })
        const env = getEnvForModel(model, agent as Agent, credentials)
        applyTurnSecretsToEnv(env, planned.map((s) => ({ ...s, placeholder: placeholderFor(s.name) })))
        for (const value of Object.values(env)) expect(Object.values(ownKeys)).not.toContain(value)
      })
    }
  }
})
