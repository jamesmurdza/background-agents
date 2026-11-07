/**
 * Unit tests for the set of Daytona secrets a turn mounts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Daytona, Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

import { forgetSecrets, toSecretMarker } from "@background-agents/sandbox-secrets"
import { agentModels, getEnvForModel, type Agent, type CredentialId, type CustomEndpoint } from "@background-agents/common"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import { USER_KEY_PROVIDERS, userKeySecretName, userKeySecretSpec } from "./user-key-secrets"
import { claudeOwnSecretPrefix, claudeSharedSecretSpec, codexSecretSpec } from "./subscription-secrets"
import { buildCodexAuthJson } from "@/lib/codex-credentials"
import {
  PINNED_SECRETS_LABEL as PINNED,
  TURN_SECRETS_LABEL as LABEL,
  KEEPALIVE_MOUNT_ENV,
  KEEPALIVE_SECRET,
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

function fakeSandbox(labels: Record<string, string> = {}) {
  const sandbox = {
    id: "sb-1",
    labels: { ...labels },
    updateSecrets: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    // Booted with the secrets proxy.
    process: { executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "http://172.20.0.1:18080" }) },
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
      })).toMatchObject([{ kind: "user", envValue: "oc-own" }])
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
      {
        kind: "user",
        name: codexSecretSpec(USER, "eyJ.codex.access").name,
        mountEnv: "USER_KEY_CODEX_CREDENTIALS",
        envValue: "eyJ.codex.access",
        envKeys: ["CODEX_CREDENTIALS"],
      },
    ])
    const env: Record<string, string> = { CODEX_CREDENTIALS: authJson }
    const ready = planned.map((secret) => ({ ...secret, placeholder: placeholderFor(secret.name) }))
    applyTurnSecretsToEnv(env, ready)
    const file = JSON.parse(env.CODEX_CREDENTIALS)
    expect(file.tokens.access_token).toBe(ready[0].placeholder)
    expect(file.tokens.id_token).toBe("eyJ.codex.id")
    expect(env.CODEX_CREDENTIALS).not.toContain("eyJ.codex.access")
  })

  it("plans the shared Claude token, which no env var carries", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_SHARED"
    expect(
      planTurnSecrets({ userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "shared", token: "sk-ant-oat01-x" } })
    ).toMatchObject([
      { kind: "claude", name: claudeSharedSecretSpec("sk-ant-oat01-x").name, mountEnv: "SESSION_RELAY_TOKEN_CLAUDE", envKeys: [] },
    ])
  })

  it("plans the user's own Claude subscription token under their name", () => {
    process.env.DAYTONA_USER_KEY_SECRETS = "CLAUDE_CODE_CREDENTIALS"
    const [secret, ...rest] = planTurnSecrets({
      userId: USER, agent: "claude-code", model: "sonnet", credentials: {}, claudeToken: { source: "own", token: "sk-ant-oat01-own" },
    })
    expect(rest).toEqual([])
    expect(secret).toMatchObject({ kind: "claude", mountEnv: "SESSION_RELAY_TOKEN_CLAUDE", envKeys: [] })
    expect(secret.name.startsWith(claudeOwnSecretPrefix(USER))).toBe(true)
    expect(secret.spec?.hosts).toEqual(["api.anthropic.com"])
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

  it("hands back the placeholder of the token the turn mounted, with no API call", async () => {
    const name = claudeSharedSecretSpec(`tok-${counter}`).name
    const sandbox = fakeSandbox({ [LABEL]: `SESSION_RELAY_TOKEN_CLAUDE:${name}` })
    const { daytona } = daytonaWith(sandbox)
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBe(placeholderFor(name))
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("swaps in a refreshed token's secret mid-turn, keeping the rest", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0) // no propagation wait
    const pinned = `${KEEPALIVE_MOUNT_ENV}:${KEEPALIVE_SECRET.name}`
    const old = claudeSharedSecretSpec("old-token").name
    const sandbox = fakeSandbox({
      [LABEL]: `SESSION_RELAY_TOKEN_CLAUDE:${old}:SESSION_RELAY_TOKEN:${SECRET_1}:${pinned}`,
      [PINNED]: pinned,
    })
    const { daytona } = daytonaWith(sandbox)
    const token = `new-token-${counter++}`
    const name = claudeSharedSecretSpec(token).name
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(token))).toBe(placeholderFor(name))
    expect(sandbox.updateSecrets).toHaveBeenCalledWith({
      [KEEPALIVE_MOUNT_ENV]: KEEPALIVE_SECRET.name,
      SESSION_RELAY_TOKEN_CLAUDE: name,
      SESSION_RELAY_TOKEN: SECRET_1,
    })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.labels[PINNED]).toBe(pinned)
  })

  it("never enables secrets mid-run: that restart would kill the agent", async () => {
    const sandbox = fakeSandbox({ repo: "o/r" })
    const { daytona } = daytonaWith(sandbox)
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBeUndefined()
    expect(sandbox.updateSecrets).not.toHaveBeenCalled()
  })

  it("falls back to the token when off or when the secret fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { secret, daytona } = daytonaWith(fakeSandbox({ [LABEL]: "none" }))
    secret.list.mockRejectedValue(new Error("403"))
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBeUndefined()
    process.env.DAYTONA_USER_KEY_SECRETS = ""
    expect(await mountClaudeSecret(daytona, "sb-1", USER, shared(`tok-${counter++}`))).toBeUndefined()
  })
})

describe("ensureTurnSecrets", () => {
  it("resolves every secret's placeholder, creating user secrets from their spec", async () => {
    const { secret, daytona } = fakeDaytona()
    const key = `sk-ant-${counter++}`
    const { placeholder: _placeholder, ...planned } = ownKey("ANTHROPIC_API_KEY", key)
    expect(await ensureTurnSecrets(daytona, [planned])).toEqual([
      { ...planned, placeholder: placeholderFor(planned.name) },
      KEEPALIVE,
    ])
    expect(secret.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: planned.name, value: key, hosts: ["api.anthropic.com"] })
    )
  })

  it("adds no keepalive when there is nothing to mount, and mounts without it when it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { secret, daytona } = fakeDaytona()
    expect(await ensureTurnSecrets(daytona, [])).toEqual([])
    forgetSecrets([KEEPALIVE_SECRET.name])
    secret.create.mockImplementation(async ({ name }: { name: string }) => {
      if (name === KEEPALIVE_SECRET.name) throw new Error("quota")
      return { name, placeholder: placeholderFor(name) }
    })
    const { placeholder: _placeholder, ...planned } = ownKey("OPENAI_API_KEY", `sk-${counter++}`)
    expect(await ensureTurnSecrets(daytona, [planned])).toEqual([{ ...planned, placeholder: placeholderFor(planned.name) }])
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

const KEEPALIVE: ReadyTurnSecret = {
  kind: "keepalive",
  name: KEEPALIVE_SECRET.name,
  mountEnv: KEEPALIVE_MOUNT_ENV,
  envValue: "",
  envKeys: [],
  placeholder: placeholderFor(KEEPALIVE_SECRET.name),
}
const KEPT = `${KEEPALIVE_MOUNT_ENV}:${KEEPALIVE_SECRET.name}`

describe("mountTurnSecrets", () => {
  it("pins the keepalive, so a turn's end and a turn with nothing to mount both keep it", async () => {
    const sandbox = fakeSandbox({ [LABEL]: "none" })
    await mountTurnSecrets(asSandbox(sandbox), [POOL_1, KEEPALIVE])
    expect(sandbox.labels[PINNED]).toBe(KEPT)

    await releaseTurnSecrets(asSandbox(sandbox))
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ [KEEPALIVE_MOUNT_ENV]: KEEPALIVE_SECRET.name })
    expect(sandbox.labels[LABEL]).toBe(KEPT)

    await mountTurnSecrets(asSandbox(sandbox), [POOL_1, KEEPALIVE])
    await mountTurnSecrets(asSandbox(sandbox), [])
    expect(sandbox.updateSecrets).toHaveBeenLastCalledWith({ [KEEPALIVE_MOUNT_ENV]: KEEPALIVE_SECRET.name })
    expect(sandbox.labels).toMatchObject({ [LABEL]: KEPT, [PINNED]: KEPT })
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
  it("mounts the set from the start and labels the sandbox with it", () => {
    expect(turnSecretsCreateParams([POOL_1])).toEqual({
      secrets: { SESSION_RELAY_TOKEN: SECRET_1 },
      labels: { [LABEL]: `SESSION_RELAY_TOKEN:${SECRET_1}`, [PINNED]: "none" },
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
