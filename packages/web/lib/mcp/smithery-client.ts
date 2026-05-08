/**
 * Smithery Client for MCP Tools
 *
 * Uses Smithery's REST API to execute GitHub tools on behalf of users.
 * The token is passed per-request, never stored.
 */

import Smithery from "@smithery/api"

/**
 * Create a Smithery client instance
 * Note: We'll use service tokens or direct tool calls
 */
export function createSmitheryClient(apiKey?: string) {
  return new Smithery({
    apiKey: apiKey || process.env.SMITHERY_API_KEY,
  })
}

/**
 * GitHub MCP Server identifier on Smithery
 */
export const GITHUB_MCP_SERVER = "@smithery-ai/github"

/**
 * Tool call result from Smithery
 */
export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Call a GitHub tool via Smithery REST API
 *
 * @param connectionId - The Smithery connection ID
 * @param toolName - The tool to call (e.g., "get_issue")
 * @param args - Tool arguments
 * @param namespace - Smithery namespace
 */
export async function callGitHubTool(
  client: Smithery,
  connectionId: string,
  namespace: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  try {
    const result = await client.connections.tools.call(toolName, {
      namespace,
      connectionId,
      body: args,
    })

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * List available tools from a connection
 */
export async function listTools(
  client: Smithery,
  connectionId: string,
  namespace: string
) {
  try {
    const result = await client.connections.tools.list(connectionId, {
      namespace,
    })
    return result.tools
  } catch (error) {
    console.error("Failed to list tools:", error)
    return []
  }
}
