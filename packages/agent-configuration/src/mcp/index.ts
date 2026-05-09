/**
 * MCP Configuration Generator
 *
 * Generates the correct MCP config format for each agent type.
 * Each agent has a different config file location and format.
 */

import type { Sandbox } from "@daytonaio/sdk"

// =============================================================================
// Types
// =============================================================================

export interface McpServerConfig {
  url: string
  transport: "sse" | "http"
}

export interface McpConfigResult {
  filePath: string
  content: string
}

export interface McpToolsConfig {
  github?: boolean
  jira?: boolean
  slack?: boolean
  linear?: boolean
}

// =============================================================================
// Agent Support
// =============================================================================

/**
 * Agents that support MCP
 */
export const MCP_SUPPORTED_AGENTS = [
  "claude-code",
  "codex",
  "gemini",
  "opencode",
  "goose",
] as const

export type McpSupportedAgent = (typeof MCP_SUPPORTED_AGENTS)[number]

/**
 * Check if an agent supports MCP
 */
export function agentSupportsMcp(agent: string): agent is McpSupportedAgent {
  return MCP_SUPPORTED_AGENTS.includes(agent as McpSupportedAgent)
}

// =============================================================================
// Config Generators
// =============================================================================

/**
 * Generate MCP config for a specific agent
 */
export function generateMcpConfig(
  agent: string,
  sandboxId: string,
  baseUrl: string
): McpConfigResult | null {
  if (!agentSupportsMcp(agent)) {
    return null // Pi and others don't support MCP
  }

  const mcpUrl = `${baseUrl}/api/mcp/${sandboxId}/sse`

  switch (agent) {
    case "claude-code":
      return generateClaudeConfig(mcpUrl)
    case "codex":
      return generateCodexConfig(mcpUrl)
    case "gemini":
      return generateGeminiConfig(mcpUrl)
    case "opencode":
      return generateOpenCodeConfig(mcpUrl)
    case "goose":
      return generateGooseConfig(mcpUrl)
    default:
      return null
  }
}

/**
 * Claude Code: ~/.claude.json
 *
 * Claude Code uses a JSON config with mcpServers section.
 * Config is merged with existing settings.
 */
function generateClaudeConfig(mcpUrl: string): McpConfigResult {
  const config = {
    mcpServers: {
      "daytona-github": {
        type: "http",
        url: mcpUrl,
      },
    },
  }
  return {
    filePath: "/home/daytona/.claude.json",
    content: JSON.stringify(config, null, 2),
  }
}

/**
 * Codex (OpenAI): ~/.codex/config.toml
 *
 * Codex uses TOML format with [mcp.servers] section.
 */
function generateCodexConfig(mcpUrl: string): McpConfigResult {
  const config = `
[mcp.servers.daytona-github]
type = "http"
url = "${mcpUrl}"
`
  return {
    filePath: "/home/daytona/.codex/config.toml",
    content: config.trim(),
  }
}

/**
 * Gemini CLI: ~/.gemini/settings.json
 *
 * Gemini uses JSON format with mcpServers section.
 */
function generateGeminiConfig(mcpUrl: string): McpConfigResult {
  const config = {
    mcpServers: {
      "daytona-github": {
        type: "sse",
        url: mcpUrl,
      },
    },
  }
  return {
    filePath: "/home/daytona/.gemini/settings.json",
    content: JSON.stringify(config, null, 2),
  }
}

/**
 * OpenCode: .opencode/config.json (project-level)
 *
 * OpenCode uses JSON format with mcp.servers section.
 * Config is in the project directory.
 */
function generateOpenCodeConfig(mcpUrl: string): McpConfigResult {
  const config = {
    mcp: {
      servers: {
        "daytona-github": {
          url: mcpUrl,
          transport: "sse",
        },
      },
    },
  }
  return {
    filePath: "/home/daytona/project/.opencode/config.json",
    content: JSON.stringify(config, null, 2),
  }
}

/**
 * Goose: ~/.config/goose/config.yaml
 *
 * Goose uses YAML format with extensions section.
 */
function generateGooseConfig(mcpUrl: string): McpConfigResult {
  const config = `
extensions:
  daytona-github:
    type: sse
    uri: "${mcpUrl}"
    enabled: true
`
  return {
    filePath: "/home/daytona/.config/goose/config.yaml",
    content: config.trim(),
  }
}

// =============================================================================
// Setup Function
// =============================================================================

interface McpSetupOptions {
  agent: string
  sandboxId: string
  baseUrl: string
  mcpTools: McpToolsConfig | null
}

/**
 * Setup MCP configuration for an agent in the sandbox.
 *
 * This writes the MCP config file for the agent, enabling it to
 * connect to our MCP proxy endpoint.
 *
 * @param sandbox - The Daytona sandbox instance
 * @param options - MCP setup options
 */
export async function setupMcpForAgent(
  sandbox: Sandbox,
  options: McpSetupOptions
): Promise<void> {
  const { agent, sandboxId, baseUrl, mcpTools } = options

  console.log(`[MCP] setupMcpForAgent called`, {
    agent,
    sandboxId,
    baseUrl,
    mcpTools,
  })

  // Skip if agent doesn't support MCP
  if (!agentSupportsMcp(agent)) {
    console.warn(
      `[MCP] Skipping setup for "${agent}" — agent not in MCP_SUPPORTED_AGENTS (${MCP_SUPPORTED_AGENTS.join(", ")})`
    )
    return
  }

  // Skip if no MCP tools enabled
  const enabled = mcpTools
    ? Object.entries(mcpTools).filter(([, v]) => v).map(([k]) => k)
    : []
  if (enabled.length === 0) {
    console.warn(`[MCP] Skipping setup for "${agent}" — no tools enabled in mcpTools`)
    return
  }
  console.log(`[MCP] Tools enabled for "${agent}":`, enabled)

  // Generate config for this agent
  const config = generateMcpConfig(agent, sandboxId, baseUrl)
  if (!config) {
    console.warn(`[MCP] generateMcpConfig returned null for "${agent}"`)
    return
  }
  console.log(`[MCP] Generated config for "${agent}":`, {
    filePath: config.filePath,
    content: config.content,
  })

  // Get directory from file path
  const dir = config.filePath.substring(0, config.filePath.lastIndexOf("/"))

  // Create directory if needed
  await sandbox.process.executeCommand(`mkdir -p ${dir}`)

  // For JSON configs, merge with existing content
  // For TOML/YAML, just write new content (agents handle merging)
  if (config.filePath.endsWith(".json")) {
    await mergeJsonConfig(sandbox, config.filePath, config.content)
  } else {
    // Write the config file directly
    await sandbox.fs.uploadFile(
      Buffer.from(config.content, "utf-8"),
      config.filePath
    )
  }

  // Verify what was actually written so we can rule out merge problems
  try {
    const verify = (await sandbox.process.executeCommand(
      `cat "${config.filePath}"`
    )) as { result: string }
    console.log(
      `[MCP] Wrote MCP config for "${agent}" to ${config.filePath} — final contents:\n${verify.result}`
    )
  } catch (err) {
    console.warn(`[MCP] Wrote config but failed to read it back: ${String(err)}`)
  }
}

/**
 * Merge new JSON config with existing config file.
 *
 * This ensures we don't overwrite user settings, only add/update
 * the mcpServers section.
 */
async function mergeJsonConfig(
  sandbox: Sandbox,
  filePath: string,
  newContent: string
): Promise<void> {
  // Read existing config
  const existingResult = (await sandbox.process.executeCommand(
    `cat "${filePath}" 2>/dev/null || echo '{}'`
  )) as { result: string }

  let existing: Record<string, unknown>
  try {
    existing = JSON.parse(existingResult.result.trim() || "{}")
  } catch {
    existing = {}
  }

  // Parse new config
  const newConfig = JSON.parse(newContent) as Record<string, unknown>

  // Merge - new config takes precedence for mcpServers
  if (newConfig.mcpServers) {
    const existingMcp = (existing.mcpServers as Record<string, unknown>) || {}
    const newMcp = newConfig.mcpServers as Record<string, unknown>
    existing.mcpServers = { ...existingMcp, ...newMcp }
  }

  // Merge MCP section (for OpenCode format)
  if (newConfig.mcp) {
    const existingMcp = (existing.mcp as Record<string, unknown>) || {}
    const newMcp = newConfig.mcp as Record<string, unknown>
    existing.mcp = { ...existingMcp, ...newMcp }
  }

  // Write merged config
  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(existing, null, 2), "utf-8"),
    filePath
  )
}
