/**
 * MCP Types
 *
 * Types for MCP (Model Context Protocol) tools configuration
 */

/**
 * MCP tools configuration stored in Chat.mcpTools
 * Each key represents a tool provider, value indicates if enabled
 */
export interface McpToolsConfig {
  github?: boolean
  jira?: boolean
  slack?: boolean
  linear?: boolean
}

/**
 * Smithery MCP server URLs (*.run.tools format)
 * These are the actual MCP endpoints that accept GitHub tokens directly
 */
export const SMITHERY_MCP_SERVERS: Record<keyof McpToolsConfig, string> = {
  github: "https://github.run.tools",
  jira: "https://jira.run.tools", // Coming soon
  slack: "https://slack.run.tools", // Coming soon
  linear: "https://linear.run.tools", // Coming soon
}

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

/**
 * Validate McpToolsConfig from unknown JSON
 */
export function parseMcpToolsConfig(
  value: unknown
): McpToolsConfig | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const config = value as Record<string, unknown>
  const result: McpToolsConfig = {}

  if (typeof config.github === "boolean") result.github = config.github
  if (typeof config.jira === "boolean") result.jira = config.jira
  if (typeof config.slack === "boolean") result.slack = config.slack
  if (typeof config.linear === "boolean") result.linear = config.linear

  return result
}

/**
 * Check if any MCP tools are enabled
 */
export function hasEnabledMcpTools(config: McpToolsConfig | null): boolean {
  if (!config) return false
  return Object.values(config).some(Boolean)
}
