/**
 * Load a chat's connected MCP servers in the shape `setupMcpForAgent` wants.
 *
 * Returns only `connected` rows (skips pending/error). Decrypts the per-row
 * Smithery API key here so callers don't need to touch encryption.
 */
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import type { AgentMcpServer } from "@upstream/agent-configuration/mcp"

/** Sanitize Smithery's slugs into a name acceptable to every agent CLI. */
function safeServerName(qualifiedName: string): string {
  return qualifiedName
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase()
}

export async function loadChatMcpServers(
  chatId: string
): Promise<AgentMcpServer[]> {
  const rows = await prisma.chatMcpServer.findMany({
    where: { chatId, status: "connected" },
    select: {
      qualifiedName: true,
      mcpUrl: true,
      encryptedApiKey: true,
    },
  })

  const out: AgentMcpServer[] = []
  for (const row of rows) {
    if (!row.encryptedApiKey || !row.mcpUrl) continue
    out.push({
      name: safeServerName(row.qualifiedName),
      url: row.mcpUrl,
      bearerToken: decrypt(row.encryptedApiKey),
    })
  }
  return out
}
