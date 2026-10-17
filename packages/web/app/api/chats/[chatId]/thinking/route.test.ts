import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { THINKING_SERVER_TIMEOUT_MS } from "@background-agents/sdk/thinking"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), chat: vi.fn(), sandbox: vi.fn(), capability: vi.fn(), env: vi.fn(),
}))
vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: mocks.auth,
  getChatWithAuth: mocks.chat,
  isAuthError: (value: unknown) => value instanceof Response,
  notFound: (error: string) => Response.json({ error }, { status: 404 }),
}))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class { get = mocks.sandbox } }))
vi.mock("@background-agents/sdk", () => ({ adaptSandbox: (value: unknown) => value }))
vi.mock("@background-agents/sdk/thinking-runtime", () => ({ getRuntimeThinkingCapability: mocks.capability }))
vi.mock("../messages/_lib/agent-env", () => ({ buildAgentEnv: mocks.env }))
import { GET } from "./route"

const request = (agent = "opencode", model = "opencode/big-pickle") => new NextRequest(`http://localhost/api/chats/owned/thinking?${new URLSearchParams({ agent, model })}`)
const params = { params: Promise.resolve({ chatId: "owned" }) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "viewer" })
  mocks.chat.mockResolvedValue({ agent: "opencode", model: "opencode/big-pickle", sandboxId: "owned-sandbox" })
  mocks.env.mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers() })

describe("read-only thinking capability discovery", () => {
  it("requires login before looking up a chat or sandbox", async () => {
    mocks.auth.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }))
    expect((await GET(request(), params)).status).toBe(401)
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("does not discover another user's sandbox", async () => {
    mocks.chat.mockResolvedValue(null)
    expect((await GET(request(), params)).status).toBe(404)
    expect(mocks.chat).toHaveBeenCalledWith("owned", "viewer")
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("serves recorded first-prompt choices without provisioning cloud resources", async () => {
    mocks.chat.mockResolvedValue({ sandboxId: null })
    const response = await GET(request("codex", "gpt-6.1-sol"), params)
    expect((await response.json()).levels).toContain("high")
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it.each([["codex", "gpt-6.1-sol", "codex"], ["claude-code", "sonnet", "claude"]])("checks contextual %s routing rather than returning static policy", async (agent, model, provider) => {
    const sandbox = { state: "started" }
    mocks.sandbox.mockResolvedValue(sandbox)
    mocks.env.mockResolvedValue({ OPENAI_BASE_URL: "https://qa.invalid", ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-model" })
    mocks.capability.mockResolvedValue({ levels: [], status: "unverified", reason: "Custom route not verified" })
    expect(await (await GET(request(agent, model), params)).json()).toMatchObject({ levels: [], status: "unverified" })
    expect(mocks.capability).toHaveBeenCalledWith(provider, model, sandbox, {
      cwd: "/home/daytona/project", env: { OPENAI_BASE_URL: "https://qa.invalid", ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-model" },
    })
  })
  it("does not turn Claude policy into verified first-prompt evidence", async () => {
    mocks.chat.mockResolvedValue({ sandboxId: null })
    expect(await (await GET(request("claude-code", "sonnet"), params)).json()).toMatchObject({ levels: [], status: "runtime_unavailable" })
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("does not query a sandbox for agents with no applicable thinking controls", async () => {
    expect(await (await GET(request("eliza", "eliza-classic-1.0"), params)).json()).toMatchObject({ levels: [], status: "no_controls" })
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("does not provision or wake a sandbox just to open the picker", async () => {
    mocks.chat.mockResolvedValueOnce({ sandboxId: null })
    expect((await (await GET(request(), params)).json()).levels).toEqual([])
    expect(mocks.sandbox).not.toHaveBeenCalled()
    mocks.sandbox.mockResolvedValue({ state: "stopped" })
    expect((await (await GET(request(), params)).json()).levels).toEqual([])
    expect(mocks.capability).not.toHaveBeenCalled()
  })
  it("reads only the owned, running runtime and returns its advertised levels", async () => {
    const sandbox = { state: "started" }
    mocks.sandbox.mockResolvedValue(sandbox)
    mocks.capability.mockResolvedValue({ levels: ["low", "high"], control: "opencode-variant" })
    expect((await (await GET(request(), params)).json()).levels).toEqual(["low", "high"])
    expect(mocks.sandbox).toHaveBeenCalledWith("owned-sandbox")
    expect(mocks.capability).toHaveBeenCalledWith("opencode", "opencode/big-pickle", sandbox, { cwd: "/home/daytona/project", env: {} })
  })
  it("returns a useful default-only fallback without exposing backend error details", async () => {
    mocks.sandbox.mockRejectedValue(new Error("private upstream diagnostic"))
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.levels).toEqual([])
    expect(body.status).toBe("check_failed")
    expect(body.reason).toContain("Default")
    expect(JSON.stringify(body)).not.toContain("private upstream")
  })
  it("rejects unknown agent identities before looking up a runtime", async () => {
    expect((await GET(request("not-an-agent"), params)).status).toBe(400)
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("distinguishes a stopped runtime from verified absence of controls", async () => {
    mocks.sandbox.mockResolvedValue({ state: "stopped" })
    expect(await (await GET(request(), params)).json()).toMatchObject({ status: "runtime_unavailable" })
  })
  it("checks the launch working directory and configuration without passing credentials", async () => {
    const sandbox = { state: "started" }
    mocks.sandbox.mockResolvedValue(sandbox)
    mocks.env.mockResolvedValue({ PATH: "/home/daytona/project/bin:/usr/bin", OPENCODE_CONFIG: "/home/daytona/project/local.json", OPENAI_API_KEY: "fixture-not-a-real-key", CUSTOM_OPENCODE_BASE_URL: "https://qa.invalid" })
    mocks.capability.mockResolvedValue({ levels: [], status: "unverified" })
    await GET(request(), params)
    expect(mocks.capability).toHaveBeenCalledWith("opencode", "opencode/big-pickle", sandbox, {
      cwd: "/home/daytona/project", env: { PATH: "/home/daytona/project/bin:/usr/bin", OPENCODE_CONFIG: "/home/daytona/project/local.json", CUSTOM_OPENCODE_BASE_URL: "https://qa.invalid" },
    })
    expect(mocks.env).toHaveBeenCalledWith(expect.objectContaining({ userId: "viewer", credentials: {} }))
  })
  it("keeps verified initial choices while a sandbox is absent", async () => {
    mocks.chat.mockResolvedValue({ sandboxId: null })
    const result = await GET(request("opencode", "opencode/longcat-2.5-preview-free"), params)
    expect(result.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await result.json()).toMatchObject({ status: "runtime_unavailable", levels: ["low", "medium", "high"] })
    expect(mocks.sandbox).not.toHaveBeenCalled()
  })
  it("bounds a hung cloud lookup and leaves a retryable diagnosis", async () => {
    vi.useFakeTimers()
    mocks.sandbox.mockReturnValue(new Promise(() => {}))
    const pending = GET(request(), params)
    await vi.advanceTimersByTimeAsync(THINKING_SERVER_TIMEOUT_MS)
    expect(await (await pending).json()).toMatchObject({ status: "check_failed", levels: [] })
    expect(mocks.capability).not.toHaveBeenCalled()
  })
})
