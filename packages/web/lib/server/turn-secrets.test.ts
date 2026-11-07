/**
 * Unit tests for the set of Daytona secrets a turn mounts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { secretName, toSecretMarker } from "@background-agents/sandbox-secrets"
import { agentModels, getEnvForModel, type Agent, type CredentialId, type CustomEndpoint } from "@background-agents/common"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import { USER_KEY_PROVIDERS } from "./user-key-secrets"
import { CLAUDE_SECRET_HOSTS, CLAUDE_SHARED_MOUNT_ENV } from "./subscription-secrets"
import { buildCodexAuthJson } from "@/lib/codex-credentials"
import {
  applyTurnSecretsToEnv,
  ensureTurnSecrets,
  mountClaudeSecret,
  mountTurnSecrets,
  planTurnSecrets,
  poolSecretOf,
  releaseTurnSecrets,
  turnSecretsCreateParams,
  type ReadyTurnSecret,
  type TurnSecret,
} from "./turn-secrets"

function fakeSandbox() {
  const sandbox = {
    id: "sb-1",
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    process: { executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "http://172.20.0.1:18080" }) },
  }
  return sandbox
}

const asSandbox = (sandbox: ReturnType<typeof fakeSandbox>) => sandbox as unknown as DaytonaSandbox

const placeholderFor = (name: string) => `dtn_secret_${name}`

function fakeDaytona() {
  const secret = {
    list: vi.fn().mockResolvedValue({ items: [] }),
    create: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({ name, placeholder: placeholderFor(name) })),
    update: vi.fn().mockResolvedValue({}),
  }
  const daytona = { secret, get: vi.fn() } as unknown as Daytona
  return { secret, daytona }
}

const USER = "user-1"
const SECRET_1 = secretNameForKey(SHARED_KEY_POOLS.opencode, "key-1")
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

function ready(secret: Partial<ReadyTurnSecret> & Pick<ReadyTurnSecret, "name" | "mountEnv">): ReadyTurnSecret {
  return {
    kind: "pool",
    value: toSecretMarker(secret.name),
    envKeys: ["OPENCODE_API_KEY"],
    placeholder: placeholderFor(secret.name),
    ...secret,
  }
}

const POOL_1 = ready({ name: SECRET_1, mountEnv: "SESSION_RELAY_TOKEN", poolSecretName: SECRET_1 })

function ownKey(credential: CredentialId, value: string, extra: Partial<ReadyTurnSecret> = {}): ReadyTurnSecret {
  const hosts = USER_KEY_PROVIDERS[credential]?.hosts
  const name = secretName(value, hosts ?? [])
  return {
    kind: "user",
    name,
    hosts,
    value,
    mountEnv: `USER_KEY_${credential}`,
    envKeys: [credential],
    bypassEnv: USER_KEY_PROVIDERS[credential]?.baseUrlEnv,
    placeholder: placeholderFor(name),
    ...extra,
  }
}

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
      { kind: "pool", value: marker, mountEnv: "SESSION_RELAY_TOKEN", envKeys: ["OPENCODE_API_KEY"], poolSecretName: SECRET_1 },
    ])
  })

  it("passes a pool key raw when the pool's secrets are off, never as the user's own key", () => {
    process.env.OPENCODE_API_KEY = "oc-pool-raw"
    process.env.DAYTONA_USER_KEY_SECRETS = "OPENCODE_API_KEY"
    try {
      expect(planTurnSecrets({
        userId: USER, agent: "opencode", model: "opencode-go/mimo-v2.5-pro", credentials: { OPENCODE_API_KEY: "oc-pool-raw" },
      })).toEqual([])
      // The user's own key still is.
      expect(planTurnSecrets({
        userId: USER, agent: "opencode", model: "opencode-go/mimo-v2.5-pro", credentials: { OPENCODE_API_KEY: "oc-own" },
      })).toMatchObject([{ kind: "user", value: "oc-own" }])
    } finally {
      delete process.env.OPENCODE_API_KEY
    }
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
        value: "sk-own",
        mountEnv: "USER_KEY_OPENAI_API_KEY",
        envKeys: ["OPENAI_API_KEY"],
        hosts: ["api.openai.com"],
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
})

describe("planTurnSecrets with a custom endpoint", () => {
  it("plans no secrets: the endpoint's key, under a provider's name, isn't that provider's", () => {
    const ep: CustomEndpoint = {
      id: "e1", name: "proxy", type: "anthropic", baseUrl: "https://proxy.example.com/v1", model: "m", headers: "x-api-key: ep-key",
    }
    expect(planTurnSecrets({
      userId: USER, agent: "claude-code", model: "endpoint:e1", credentials: { ANTHROPIC_API_KEY: "sk-ant-own" }, endpoints: [ep],
    })).toEqual([])
  })
})

describe("planTurnSecrets with subscriptions", () => {
  const authJson = buildCodexAuthJson(
    {
      refresh_token: "rt-real",
      access_token: "eyJ.codex.access",
      id_token: "eyJ.codex.id",
      account_id: "acct",
      expires_at: 2_000_000_000,
      earliest_refresh_at: 1_999_000_000,
      last_refresh: "2026-10-28T00:00:00.000Z",
      status: "connected",
    },
    Date.now()
  )

  it("plans the Codex access token, swapped inside auth.json", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CODEX_CREDENTIALS"
    const planned = planTurnSecrets({ userId: USER, agent: "codex", model: "gpt-6.1-sol", credentials: { CODEX_CREDENTIALS: authJson } })
    expect(planned).toMatchObject([
      { kind: "user", value: "eyJ.codex.access", mountEnv: "USER_KEY_CODEX_CREDENTIALS", envKeys: ["CODEX_CREDENTIALS"] },
    ])
    const env: Record<string, string> = { CODEX_CREDENTIALS: authJson }
    const readySecrets = planned.map((secret) => {
      const name = secretName(secret.value, secret.hosts ?? [])
      return { ...secret, name, placeholder: placeholderFor(name) }
    })
    applyTurnSecretsToEnv(env, readySecrets)
    const file = JSON.parse(env.CODEX_CREDENTIALS)
    expect(file.tokens.access_token).toBe(readySecrets[0].placeholder)
    expect(file.tokens.id_token).toBe("eyJ.codex.id")
    expect(env.CODEX_CREDENTIALS).not.toContain("eyJ.codex.access")
  })

  it("plans the shared Claude token, which no env var carries", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_SHARED"
    expect(
      planTurnSecrets({ userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "shared", token: "sk-ant-oat01-x" } })
    ).toMatchObject([
      { kind: "claude", value: "sk-ant-oat01-x", mountEnv: "SESSION_RELAY_TOKEN_CLAUDE", envKeys: [], hosts: CLAUDE_SECRET_HOSTS },
    ])
  })

  it("plans the user's own Claude subscription token", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_CODE_CREDENTIALS"
    const [secret, ...rest] = planTurnSecrets({
      userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "own", token: "sk-ant-oat01-own" },
    })
    expect(rest).toEqual([])
    expect(secret).toMatchObject({ kind: "claude", value: "sk-ant-oat01-own", mountEnv: "SESSION_RELAY_TOKEN_CLAUDE", envKeys: [] })
    expect(secret.hosts).toEqual(["api.anthropic.com"])
    // Its flag is separate from the shared token's.
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_SHARED"
    expect(planTurnSecrets({
      userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "own", token: "t" },
    })).toEqual([])
  })

  it("plans neither when left out", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "OPENAI_API_KEY"
    const run = () => [
      ...planTurnSecrets({ userId: USER, agent: "codex", model: "gpt-6.1-sol", credentials: { CODEX_CREDENTIALS: authJson } }),
      ...planTurnSecrets({ userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "shared", token: "t" } }),
      ...planTurnSecrets({ userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "own", token: "t" } }),
    ]
    expect(run()).toEqual([])
  })
})

describe("mountClaudeSecret", () => {
  const shared = (token: string) => ({ source: "shared" as const, token })
  function daytonaWith(sandbox: ReturnType<typeof fakeSandbox>) {
    const { secret, daytona } = fakeDaytona()
    ;(daytona as unknown as { get: unknown }).get = vi.fn().mockResolvedValue(sandbox)
    return { secret, daytona }
  }

  beforeEach(() => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_SHARED"
  })

  it("mounts the token's secret and hands back its placeholder", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = daytonaWith(sandbox)
    const token = `tok-${counter++}`
    const name = secretName(token, CLAUDE_SECRET_HOSTS)
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(token))).toBe(placeholderFor(name))
    expect(sandbox.updateSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ [CLAUDE_SHARED_MOUNT_ENV]: name })
    )
  })

  it("keeps the rest of the turn's known secrets mounted alongside the Claude one", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = daytonaWith(sandbox)
    const token = `tok-${counter++}`
    const name = secretName(token, CLAUDE_SECRET_HOSTS)
    await mountClaudeSecret(daytona, "sb-1", USER, shared(token), { SESSION_RELAY_TOKEN: SECRET_1 })
    expect(sandbox.updateSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ SESSION_RELAY_TOKEN: SECRET_1, [CLAUDE_SHARED_MOUNT_ENV]: name })
    )
  })

  it("falls back to the token when the feature is off", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = ""
    const sandbox = fakeSandbox()
    const { daytona } = daytonaWith(sandbox)
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBeUndefined()
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("falls back to the token when the secret fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { secret, daytona } = daytonaWith(fakeSandbox())
    secret.list.mockRejectedValue(new Error("403"))
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBeUndefined()
  })
})

describe("ensureTurnSecrets", () => {
  it("resolves every secret's placeholder, creating user secrets", async () => {
    const { secret, daytona } = fakeDaytona()
    const key = `sk-ant-${counter++}`
    const planned: TurnSecret = { kind: "user", value: key, hosts: ["api.anthropic.com"], mountEnv: "USER_KEY_ANTHROPIC_API_KEY", envKeys: ["ANTHROPIC_API_KEY"] }
    const [result] = await ensureTurnSecrets(daytona, [planned])
    expect(result).toMatchObject({ ...planned, name: secretName(key, ["api.anthropic.com"]), placeholder: placeholderFor(secretName(key, ["api.anthropic.com"])) })
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: secretName(key, ["api.anthropic.com"]), value: key, hosts: ["api.anthropic.com"] })
    )
  })

  it("resolves nothing when there is nothing to mount", async () => {
    const { daytona } = fakeDaytona()
    expect(await ensureTurnSecrets(daytona, [])).toEqual([])
  })

  it("leaves out a user secret that fails, so the agent gets the value as before", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { secret, daytona } = fakeDaytona()
    secret.list.mockRejectedValue(new Error("403"))
    const planned: TurnSecret = { kind: "user", value: `sk-${counter++}`, mountEnv: "USER_KEY_OPENAI_API_KEY", envKeys: ["OPENAI_API_KEY"] }
    await expect(ensureTurnSecrets(daytona, [planned])).resolves.toEqual([])
  })

  it("fails the turn when a pool secret fails: the shared key never falls back", async () => {
    process.env.OPENCODE_API_KEY = `pool-${counter++}`
    const name = secretNameForKey(SHARED_KEY_POOLS.opencode, process.env.OPENCODE_API_KEY)
    const { secret, daytona } = fakeDaytona()
    secret.list.mockRejectedValue(new Error("403"))
    const planned: TurnSecret[] = [
      { kind: "pool", value: toSecretMarker(name), mountEnv: "SESSION_RELAY_TOKEN", envKeys: ["OPENCODE_API_KEY"], poolSecretName: name },
    ]
    await expect(ensureTurnSecrets(daytona, planned)).rejects.toThrow("403")
  })
})

describe("mountTurnSecrets", () => {
  it("mounts the turn's secrets via setSecrets", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = fakeDaytona()
    await mountTurnSecrets(daytona, asSandbox(sandbox), [POOL_1])
    expect(sandbox.updateSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ SESSION_RELAY_TOKEN: SECRET_1 })
    )
  })

  it("mounts the whole set, replacing whatever else was mounted", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = fakeDaytona()
    const own = ownKey("ANTHROPIC_API_KEY", "sk-ant-own")
    const gemini = ready({ name: GEMINI_SECRET, mountEnv: "SESSION_RELAY_TOKEN_GEMINI", envKeys: ["GEMINI_API_KEY"] })
    await mountTurnSecrets(daytona, asSandbox(sandbox), [gemini, own])
    expect(sandbox.updateSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ SESSION_RELAY_TOKEN_GEMINI: GEMINI_SECRET, USER_KEY_ANTHROPIC_API_KEY: own.name })
    )
  })

  it("with nothing to mount, detaches leftovers (keeping only the keepalive)", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = fakeDaytona()
    await mountTurnSecrets(daytona, asSandbox(sandbox), [])
    const mounted = sandbox.updateSecrets.mock.calls[0][0] as Record<string, string>
    expect(mounted.SESSION_RELAY_TOKEN).toBeUndefined()
  })
})

describe("releaseTurnSecrets", () => {
  it("detaches everything but the keepalive, and never throws", async () => {
    const sandbox = fakeSandbox()
    const { daytona } = fakeDaytona()
    await releaseTurnSecrets(daytona, asSandbox(sandbox))
    expect(sandbox.updateSecrets).toHaveBeenCalled()

    sandbox.updateSecrets.mockRejectedValueOnce(new Error("boom"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(releaseTurnSecrets(daytona, asSandbox(sandbox))).resolves.toBeUndefined()
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
})

describe("turnSecretsCreateParams", () => {
  it("builds the mounted-set map", () => {
    expect(turnSecretsCreateParams([POOL_1])).toEqual({ SESSION_RELAY_TOKEN: SECRET_1 })
  })

  it("is empty for a sandbox that needs no secrets", () => {
    expect(turnSecretsCreateParams([])).toEqual({})
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
        applyTurnSecretsToEnv(env, planned.map((s) => ({ ...s, name: secretName(s.value, s.hosts ?? []), placeholder: placeholderFor(s.value) })))
        for (const value of Object.values(env)) expect(Object.values(ownKeys)).not.toContain(value)
      })
    }
  }
})
