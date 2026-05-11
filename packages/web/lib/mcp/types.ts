/**
 * MCP Types (web-side)
 *
 * The shape of `Chat.mcpTools` and the supported-agent list are owned by
 * `@upstream/agent-configuration` so the agent setup code and the web layer
 * agree on a single definition. This file just re-exports them and adds the
 * runtime validator used when reading mcpTools from the DB / request body.
 */

export {
  type McpToolsConfig,
  type McpSupportedAgent,
  MCP_SUPPORTED_AGENTS,
  agentSupportsMcp,
} from "@upstream/agent-configuration/mcp"

import type { McpToolsConfig } from "@upstream/agent-configuration/mcp"

/**
 * Validate McpToolsConfig from unknown JSON (Prisma JSONB or request body).
 * Keeps only the recognised boolean keys; returns null for non-objects so
 * callers can distinguish "no config" from "empty config".
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
