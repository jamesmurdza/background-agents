/**
 * Unit tests for the Codex config.toml section-preserving merge.
 *
 * The MCP layer and codexSetup both write ~/.codex/config.toml; these helpers
 * let codexSetup rewrite the provider config without dropping the MCP servers
 * written before it. See toml-merge.ts.
 */
import { describe, it, expect } from "vitest"
import {
  extractTomlSections,
  combineCodexConfig,
} from "../../src/agents/codex/toml-merge"
import { buildCodexConfigToml } from "../../src/agents/codex/config"

const MCP_SECTION = [
  `[mcp_servers.github]`,
  `url = "https://api.example.com/mcp"`,
  `http_headers = { Authorization = "Bearer tok-1" }`,
  `enabled = true`,
  `startup_timeout_sec = 30`,
].join("\n")

describe("extractTomlSections", () => {
  it("keeps only sections matching a prefix and drops the preamble", () => {
    const content = [
      `model_provider = "custom"`,
      `model = "gpt-5.5"`,
      ``,
      `[model_providers.custom]`,
      `base_url = "https://gw.example.com/v1"`,
      ``,
      MCP_SECTION,
    ].join("\n")

    const kept = extractTomlSections(content, ["mcp_servers"])
    expect(kept).toContain(`[mcp_servers.github]`)
    expect(kept).toContain(`http_headers = { Authorization = "Bearer tok-1" }`)
    // Preamble and foreign sections are gone.
    expect(kept).not.toContain("model_provider")
    expect(kept).not.toContain("[model_providers.custom]")
    expect(kept).not.toContain("base_url")
  })

  it("keeps sub-tables of a matched section but not sibling sections", () => {
    const content = [
      `[mcp_servers.github]`,
      `url = "https://a/mcp"`,
      ``,
      `[mcp_servers.github.extra]`,
      `foo = "bar"`,
      ``,
      `[model_providers.custom]`,
      `base_url = "https://b/v1"`,
    ].join("\n")

    const kept = extractTomlSections(content, ["mcp_servers"])
    expect(kept).toContain(`[mcp_servers.github]`)
    expect(kept).toContain(`[mcp_servers.github.extra]`)
    expect(kept).toContain(`foo = "bar"`)
    expect(kept).not.toContain(`[model_providers.custom]`)
  })

  it("preserves the order of multiple matched sections", () => {
    const content = [
      `[mcp_servers.alpha]`,
      `url = "https://alpha/mcp"`,
      ``,
      `[mcp_servers.beta]`,
      `url = "https://beta/mcp"`,
    ].join("\n")

    const kept = extractTomlSections(content, ["mcp_servers"])
    expect(kept.indexOf("alpha")).toBeLessThan(kept.indexOf("beta"))
  })

  it("returns empty string when nothing matches or content is empty", () => {
    expect(extractTomlSections("", ["mcp_servers"])).toBe("")
    expect(
      extractTomlSections(`[model_providers.custom]\nbase_url = "x"`, [
        "mcp_servers",
      ])
    ).toBe("")
  })
})

describe("combineCodexConfig", () => {
  it("puts the provider config (with preamble) before preserved sections", () => {
    const provider = buildCodexConfigToml({
      baseUrl: "https://gw.example.com/v1",
      model: "gpt-5.5",
      headers: "Authorization: Bearer tok",
      authHeaderEnv: "CUSTOM_CODEX_AUTHORIZATION",
    })
    const merged = combineCodexConfig(provider, MCP_SECTION)

    // Top-level preamble keys must sit above every section header.
    expect(merged.indexOf("model_provider")).toBeLessThan(
      merged.indexOf("[model_providers.custom]")
    )
    expect(merged.indexOf("[model_providers.custom]")).toBeLessThan(
      merged.indexOf("[mcp_servers.github]")
    )
    expect(merged.endsWith("\n")).toBe(true)
  })

  it("returns just the preserved sections when there is no provider config", () => {
    const merged = combineCodexConfig("", MCP_SECTION)
    expect(merged).toContain("[mcp_servers.github]")
    expect(merged).not.toContain("model_provider")
    expect(merged.trim().startsWith("[mcp_servers.github]")).toBe(true)
  })

  it("returns empty string (→ remove the file) when both parts are empty", () => {
    expect(combineCodexConfig("", "")).toBe("")
    expect(combineCodexConfig("   ", "\n\n")).toBe("")
  })

  it("round-trips: extract from a merged file yields the original MCP section", () => {
    const provider = buildCodexConfigToml({
      baseUrl: "https://gw.example.com/v1",
    })
    const merged = combineCodexConfig(provider, MCP_SECTION)
    const kept = extractTomlSections(merged, ["mcp_servers"])
    expect(kept).toBe(MCP_SECTION)
  })
})
