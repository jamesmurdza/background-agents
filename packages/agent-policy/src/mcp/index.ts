/**
 * Per-agent MCP config writers.
 *
 * Each agent CLI loads MCP servers from a different config file with a
 * different schema. Given a list of `{ name, url, bearerToken }` connections
 * from the web layer, write the right file in the right format inside the
 * sandbox so the agent picks them up on startup.
 *
 * Currently emits Streamable-HTTP configs for the URL provided. Smithery's
 * connect endpoint (api.smithery.ai/connect/<ns>/<id>/mcp) is Streamable-HTTP,
 * so no per-server transport flag is needed.
 */

import type { Sandbox } from "@daytonaio/sdk"

// =============================================================================
// Types
// =============================================================================

/** One MCP server connection to write into the agent's config. */
export interface AgentMcpServer {
  /** Stable identifier for the config entry. Must be unique within the file. */
  name: string
  /** Remote MCP endpoint the agent CLI should call. */
  url: string
  /** Bearer token to send as `Authorization: Bearer <token>`. */
  bearerToken: string
}

interface McpConfigFile {
  filePath: string
  content: string
  /** JSON → use the merging path; YAML/TOML overwrite. */
  format: "json" | "toml" | "yaml"
}

const MCP_SUPPORTED_AGENTS = [
  "claude-code",
  "codex",
  "gemini",
  "opencode",
  "goose",
  "copilot",
  "kilo",
  "kimi",
] as const

type McpSupportedAgent = (typeof MCP_SUPPORTED_AGENTS)[number]

function agentSupportsMcp(agent: string): agent is McpSupportedAgent {
  return MCP_SUPPORTED_AGENTS.includes(agent as McpSupportedAgent)
}

// =============================================================================
// Per-agent generators
// =============================================================================

/**
 * Claude Code: ~/.claude.json — `mcpServers.<name>` with `type: "http"`.
 * JSON, merged with existing settings so unrelated keys survive.
 */
function generateClaudeConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] = {
      type: "http",
      url: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
    }
  }
  return {
    filePath: "/home/daytona/.claude.json",
    content: JSON.stringify({ mcpServers }, null, 2),
    format: "json",
  }
}

/**
 * Codex: ~/.codex/config.toml — `[mcp_servers.<name>]` (underscore, not dot).
 * Presence of `url` selects Streamable-HTTP; no `type` field exists.
 */
function generateCodexConfig(servers: AgentMcpServer[]): McpConfigFile {
  const lines: string[] = []
  for (const s of servers) {
    lines.push(`[mcp_servers.${s.name}]`)
    lines.push(`url = "${s.url}"`)
    lines.push(`http_headers = { Authorization = "Bearer ${s.bearerToken}" }`)
    lines.push(`enabled = true`)
    lines.push(`startup_timeout_sec = 30`)
    lines.push("")
  }
  return {
    filePath: "/home/daytona/.codex/config.toml",
    content: lines.join("\n").trimEnd(),
    format: "toml",
  }
}

/**
 * Gemini CLI: ~/.gemini/settings.json — `mcpServers.<name>.httpUrl`.
 * Use `httpUrl` (not `url`); `url` is the legacy SSE field.
 */
function generateGeminiConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] = {
      httpUrl: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
    }
  }
  return {
    filePath: "/home/daytona/.gemini/settings.json",
    content: JSON.stringify({ mcpServers }, null, 2),
    format: "json",
  }
}

/**
 * OpenCode: <project>/opencode.json — `mcp.<name>` with `type: "remote"`.
 * The `.opencode/` directory is for agents/commands/plugins, not config.
 */
function generateOpenCodeConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcp: Record<string, unknown> = {}
  for (const s of servers) {
    mcp[s.name] = {
      type: "remote",
      url: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
      enabled: true,
    }
  }
  return {
    filePath: "/home/daytona/project/opencode.json",
    content: JSON.stringify(
      { $schema: "https://opencode.ai/config.json", mcp },
      null,
      2
    ),
    format: "json",
  }
}

/**
 * Goose: ~/.config/goose/config.yaml — `extensions.<name>` with
 * `type: streamable_http`. The `streamable_http` form is the Streamable-HTTP
 * variant; `type: sse` is the legacy SSE transport.
 */
function generateGooseConfig(servers: AgentMcpServer[]): McpConfigFile {
  const lines: string[] = ["extensions:"]
  for (const s of servers) {
    lines.push(`  ${s.name}:`)
    lines.push(`    type: streamable_http`)
    lines.push(`    name: ${s.name}`)
    lines.push(`    uri: "${s.url}"`)
    lines.push(`    enabled: true`)
    lines.push(`    headers:`)
    lines.push(`      Authorization: "Bearer ${s.bearerToken}"`)
  }
  return {
    filePath: "/home/daytona/.config/goose/config.yaml",
    content: lines.join("\n"),
    format: "yaml",
  }
}

/**
 * GitHub Copilot CLI: ~/.copilot/mcp-config.json — `mcpServers.<name>` with
 * `type: "http"`. `tools: ["*"]` allowlists every tool the server exposes;
 * Copilot does not auto-enable tools otherwise.
 */
function generateCopilotConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] = {
      type: "http",
      url: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
      tools: ["*"],
    }
  }
  return {
    filePath: "/home/daytona/.copilot/mcp-config.json",
    content: JSON.stringify({ mcpServers }, null, 2),
    format: "json",
  }
}

/**
 * Kilo CLI: ~/.config/kilo/kilo.json — `mcp.<name>` with `type: "remote"`.
 * Uses the `mcp` key (same as OpenCode), but a Kilo-specific path and the
 * `remote` transport label. We write `.json` rather than `.jsonc` because the
 * merge path JSON.parses the existing file; Kilo accepts either filename.
 */
function generateKiloConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcp: Record<string, unknown> = {}
  for (const s of servers) {
    mcp[s.name] = {
      type: "remote",
      url: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
      enabled: true,
    }
  }
  return {
    filePath: "/home/daytona/.config/kilo/kilo.json",
    content: JSON.stringify({ mcp }, null, 2),
    format: "json",
  }
}

/**
 * Kimi Code: ~/.kimi-code/mcp.json — `mcpServers.<name>` with `url` + bearer
 * `headers`. Kimi infers Streamable-HTTP from the presence of `url` (no `type`
 * field). This is a separate file from config.toml (providers/models), so the
 * two never collide; the user-level path is auto-loaded on startup.
 */
function generateKimiConfig(servers: AgentMcpServer[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.name] = {
      url: s.url,
      headers: { Authorization: `Bearer ${s.bearerToken}` },
    }
  }
  return {
    filePath: "/home/daytona/.kimi-code/mcp.json",
    content: JSON.stringify({ mcpServers }, null, 2),
    format: "json",
  }
}

function generateMcpConfigForAgent(
  agent: string,
  servers: AgentMcpServer[]
): McpConfigFile | null {
  if (!agentSupportsMcp(agent)) return null
  // NOTE: empty `servers` is intentional — we still write the config so
  // previously-connected servers are removed from the file.
  switch (agent) {
    case "claude-code":
      return generateClaudeConfig(servers)
    case "codex":
      return generateCodexConfig(servers)
    case "gemini":
      return generateGeminiConfig(servers)
    case "opencode":
      return generateOpenCodeConfig(servers)
    case "goose":
      return generateGooseConfig(servers)
    case "copilot":
      return generateCopilotConfig(servers)
    case "kilo":
      return generateKiloConfig(servers)
    case "kimi":
      return generateKimiConfig(servers)
  }
}

// =============================================================================
// Sandbox writer
// =============================================================================

export interface SetupMcpOptions {
  agent: string
  servers: AgentMcpServer[]
}

/**
 * Write the per-agent MCP config into the sandbox.
 *
 * Called once per agent run (before `createSession`). The agent picks up the
 * config when it spawns, so this must run *before* the CLI starts.
 */
export async function setupMcpForAgent(
  sandbox: Sandbox,
  { agent, servers }: SetupMcpOptions
): Promise<void> {
  if (!agentSupportsMcp(agent)) return

  // Always write — even with no servers — so removing the last connection
  // clears the previous file instead of leaving stale entries the agent CLI
  // would still try to load.
  const config = generateMcpConfigForAgent(agent, servers)
  if (!config) return

  const dir = config.filePath.substring(0, config.filePath.lastIndexOf("/"))
  await sandbox.process.executeCommand(`mkdir -p ${dir}`)

  if (config.format === "json") {
    await mergeJsonConfig(sandbox, config.filePath, config.content)
  } else {
    await sandbox.fs.uploadFile(
      Buffer.from(config.content, "utf-8"),
      config.filePath
    )
  }
}

/**
 * Merge new JSON config with existing — shallow-merge `mcpServers` and `mcp`
 * sections so we don't clobber unrelated user settings (e.g. claude-code's
 * non-MCP keys in ~/.claude.json).
 */
async function mergeJsonConfig(
  sandbox: Sandbox,
  filePath: string,
  newContent: string
): Promise<void> {
  const result = (await sandbox.process.executeCommand(
    `cat "${filePath}" 2>/dev/null || echo '{}'`
  )) as { result: string }

  let existing: Record<string, unknown>
  try {
    existing = JSON.parse(result.result.trim() || "{}")
  } catch {
    existing = {}
  }

  const incoming = JSON.parse(newContent) as Record<string, unknown>

  // Replace the MCP section wholesale — we are the source of truth for which
  // servers should be present. A shallow merge would leak removed servers
  // (e.g. user disconnects GitHub but the entry survives on disk).
  // Top-level keys outside these sections are preserved by `existing` itself.
  if (incoming.mcpServers !== undefined) {
    existing.mcpServers = incoming.mcpServers
  }
  if (incoming.mcp !== undefined) {
    existing.mcp = incoming.mcp
  }
  if (incoming.$schema && !existing.$schema) {
    existing.$schema = incoming.$schema
  }

  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(existing, null, 2), "utf-8"),
    filePath
  )
}
