import { describe, it, expect, vi, beforeEach } from "vitest"

const resolveEnvironmentForChat = vi.fn()

vi.mock("@/lib/environments", () => ({ resolveEnvironmentForChat }))
vi.mock("@background-agents/common", () => ({
  getEnvForModel: () => ({ SYSTEM_VAR: "system" }),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/types", () => ({ NEW_REPOSITORY: "__new__" }))
vi.mock("@/lib/db/encryption", () => ({
  decrypt: (v: string) => v.replace("enc:", ""),
}))

const { buildAgentEnv } = await import("./agent-env")

const baseParams = {
  userId: "user_1",
  payload: { model: "claude-sonnet-4", agent: "claude" },
  credentials: {},
  customEndpoints: [],
} as never as Parameters<typeof buildAgentEnv>[0]

function chat(overrides: Record<string, unknown> = {}) {
  return { userId: "user_1", repo: "acme/app", environmentId: null, environmentVariables: null, ...overrides }
}

describe("buildAgentEnv", () => {
  beforeEach(() => resolveEnvironmentForChat.mockReset())

  it("merges the resolved environment's variables over the system env", async () => {
    resolveEnvironmentForChat.mockResolvedValue({ variables: { API_KEY: "from-env" } })
    const env = await buildAgentEnv({ ...baseParams, chat: chat() as never })
    expect(env).toMatchObject({ SYSTEM_VAR: "system", API_KEY: "from-env" })
  })

  it("lets chat-level variables override the environment's", async () => {
    resolveEnvironmentForChat.mockResolvedValue({ variables: { API_KEY: "from-env" } })
    const env = await buildAgentEnv({
      ...baseParams,
      chat: chat({ environmentVariables: { API_KEY: "enc:from-chat" } }) as never,
    })
    expect(env.API_KEY).toBe("from-chat")
  })

  it("lets user variables override system variables", async () => {
    resolveEnvironmentForChat.mockResolvedValue({ variables: { SYSTEM_VAR: "overridden" } })
    const env = await buildAgentEnv({ ...baseParams, chat: chat() as never })
    expect(env.SYSTEM_VAR).toBe("overridden")
  })

  it("works when the chat resolves to no environment (NEW_REPOSITORY)", async () => {
    resolveEnvironmentForChat.mockResolvedValue(null)
    const env = await buildAgentEnv({ ...baseParams, chat: chat({ repo: "__new__" }) as never })
    expect(env).toEqual({ SYSTEM_VAR: "system" })
  })
})
