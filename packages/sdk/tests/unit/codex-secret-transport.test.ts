/**
 * A ChatGPT-subscription run whose access token is a Daytona secret
 * placeholder must not use Codex's websocket transport: its client rejects
 * the handshake as relayed by the secrets proxy ("Attack attempt detected").
 */
import { describe, it, expect, vi } from "vitest"
import { codexAgent } from "../../src/agents/codex"
import { buildCodexSubscriptionHttpToml, usesSecretPlaceholder } from "../../src/agents/codex/config"
import type { CodeAgentSandbox } from "../../src/types/provider"

const authJson = (accessToken: string) =>
  JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: "h.p.s", access_token: accessToken, refresh_token: "x", account_id: "a" } })

function fakeSandbox(existingConfig = "") {
  const executeCommand = vi.fn(async (command: string) => ({
    exitCode: 0,
    output: command.startsWith("cat ~/.codex/config.toml") ? existingConfig : "",
  }))
  return { sandbox: { executeCommand } as unknown as CodeAgentSandbox, commands: () => executeCommand.mock.calls.map(([c]) => c) }
}

describe("Codex subscription behind the secrets proxy", () => {
  it("writes a websocket-free copy of the default provider", async () => {
    const { sandbox, commands } = fakeSandbox()
    await codexAgent.capabilities!.setup!(sandbox, { CODEX_CREDENTIALS: authJson("dtn_secret_abc123") })
    const write = commands().find((c) => c.includes("> ~/.codex/config.toml"))
    expect(write).toContain('model_provider = "chatgpt_https"')
    expect(write).toContain("supports_websockets = false")
    expect(write).toContain("requires_openai_auth = true")
    expect(write).toContain("https://chatgpt.com/backend-api/codex")
    expect(commands().some((c) => c.includes("auth.json"))).toBe(true)
  })

  it("keeps connected MCP servers alongside it", async () => {
    const { sandbox, commands } = fakeSandbox('[mcp_servers.github]\nurl = "https://example.com/mcp"\n')
    await codexAgent.capabilities!.setup!(sandbox, { CODEX_CREDENTIALS: authJson("dtn_secret_abc123") })
    const write = commands().find((c) => c.includes("> ~/.codex/config.toml"))
    expect(write).toContain("supports_websockets = false")
    expect(write).toContain("[mcp_servers.github]")
  })

  it("leaves a run with the real token on the default provider", async () => {
    const { sandbox, commands } = fakeSandbox()
    await codexAgent.capabilities!.setup!(sandbox, { CODEX_CREDENTIALS: authJson("eyJreal.token.here") })
    expect(commands()).toContain("rm -f ~/.codex/config.toml")
    expect(commands().some((c) => c.includes("supports_websockets"))).toBe(false)
  })

  it("recognises a placeholder only", () => {
    expect(usesSecretPlaceholder(authJson("dtn_secret_x"))).toBe(true)
    expect(usesSecretPlaceholder(authJson("eyJ.a.b"))).toBe(false)
    expect(buildCodexSubscriptionHttpToml().split("\n")[0]).toBe('model_provider = "chatgpt_https"')
  })
})
