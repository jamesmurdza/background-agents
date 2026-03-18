import { decrypt } from "@/lib/encryption"
import { PATHS } from "@/lib/constants"
import type { Agent } from "@/lib/types"

interface McpServerData {
  slug: string
  name: string
  url: string
  accessToken: string | null
  refreshToken: string | null
}

/**
 * Build MCP configuration for a specific agent.
 * Returns the config path and content formatted for that agent.
 */
export function buildMcpConfig(
  servers: McpServerData[],
  agent: Agent
): {
  configPath: string
  configContent: string
  configDir: string
} {
  const configPath = PATHS.MCP_CONFIG[agent] || PATHS.MCP_CONFIG["claude-code"]
  const configDir = configPath.substring(0, configPath.lastIndexOf("/"))

  // Decrypt tokens
  const decryptedServers = servers.map((s) => ({
    ...s,
    accessToken: s.accessToken ? decrypt(s.accessToken) : null,
  }))

  // Filter out servers without tokens
  const connectedServers = decryptedServers.filter((s) => s.accessToken)

  if (connectedServers.length === 0) {
    return {
      configPath,
      configContent: "",
      configDir,
    }
  }

  let configContent: string

  switch (agent) {
    case "claude-code":
      configContent = buildClaudeCodeConfig(connectedServers)
      break
    case "opencode":
      configContent = buildOpenCodeConfig(connectedServers)
      break
    case "codex":
      configContent = buildCodexConfig(connectedServers)
      break
    default:
      configContent = buildClaudeCodeConfig(connectedServers)
  }

  return {
    configPath,
    configContent,
    configDir,
  }
}

/**
 * Claude Code MCP config format (JSON)
 * Path: ~/.claude.json
 *
 * The mcpServers config is stored at the root level of ~/.claude.json
 * Each server has: type, url, and optional headers for auth
 */
function buildClaudeCodeConfig(servers: McpServerData[]): string {
  const mcpServers: Record<string, unknown> = {}

  for (const server of servers) {
    mcpServers[server.slug] = {
      type: "http",
      url: server.url,
      headers: {
        Authorization: `Bearer ${server.accessToken}`,
      },
    }
  }

  // Return only the mcpServers object - will be merged with existing config
  return JSON.stringify({ mcpServers }, null, 2)
}

/**
 * OpenCode MCP config format (JSONC)
 * Path: ~/.config/opencode/opencode.jsonc
 */
function buildOpenCodeConfig(servers: McpServerData[]): string {
  const mcpServers: Record<string, unknown> = {}

  for (const server of servers) {
    mcpServers[server.slug] = {
      type: "remote",
      url: server.url,
      headers: {
        Authorization: `Bearer ${server.accessToken}`,
      },
    }
  }

  const config = {
    mcp: {
      servers: mcpServers,
    },
  }

  return JSON.stringify(config, null, 2)
}

/**
 * Codex MCP config format (TOML)
 * Path: ~/.codex/config.toml
 */
function buildCodexConfig(servers: McpServerData[]): string {
  const lines: string[] = []

  for (const server of servers) {
    lines.push(`[[mcp.servers]]`)
    lines.push(`name = "${escapeTomlString(server.slug)}"`)
    lines.push(`type = "http"`)
    lines.push(`url = "${escapeTomlString(server.url)}"`)
    lines.push(``)
    lines.push(`[mcp.servers.headers]`)
    lines.push(`Authorization = "Bearer ${escapeTomlString(server.accessToken || "")}"`)
    lines.push(``)
  }

  return lines.join("\n")
}

/**
 * Escape special characters for TOML strings
 */
function escapeTomlString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

/**
 * Get the shell command to write MCP config to sandbox
 * For Claude Code (~/.claude.json), we need to merge with existing config
 */
export function getMcpConfigWriteCommand(
  configDir: string,
  configPath: string,
  configContent: string,
  agent: Agent
): string {
  if (!configContent) {
    return ""
  }

  const base64Content = Buffer.from(configContent).toString("base64")

  // For Claude Code, we need to merge mcpServers with existing ~/.claude.json
  if (agent === "claude-code") {
    // Read existing config, merge mcpServers, write back
    // Uses jq-like approach with Node.js one-liner
    return `mkdir -p ${configDir} && ` +
      `existing=$(cat ${configPath} 2>/dev/null || echo '{}') && ` +
      `new_servers=$(echo '${base64Content}' | base64 -d) && ` +
      `node -e "` +
      `const existing = JSON.parse(process.argv[1] || '{}'); ` +
      `const newConfig = JSON.parse(process.argv[2]); ` +
      `existing.mcpServers = { ...(existing.mcpServers || {}), ...newConfig.mcpServers }; ` +
      `console.log(JSON.stringify(existing, null, 2));" ` +
      `"\${existing}" "\${new_servers}" > ${configPath}.tmp && ` +
      `mv ${configPath}.tmp ${configPath} && chmod 600 ${configPath}`
  }

  // For other agents, just write the file directly
  return `mkdir -p ${configDir} && echo '${base64Content}' | base64 -d > ${configPath} && chmod 600 ${configPath}`
}
