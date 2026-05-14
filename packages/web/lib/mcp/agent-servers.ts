/**
 * Load a chat's connected MCP servers in the shape `setupMcpForAgent` wants.
 *
 * Two kinds of rows:
 *   - Smithery rows  → decrypt the stored Smithery API key for the bearer.
 *   - GitHub row     → mint a fresh installation token via getInstallationToken
 *                      (tokens are 1-hour, so we re-mint on every turn instead
 *                      of trying to keep them in sync with the DB).
 */
import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import {
  createGitHubMcpProvider,
  GITHUB_MCP_QUALIFIED_NAME,
  safeServerName,
} from "@upstream/mcp-providers"
import type { AgentMcpServer } from "@upstream/agent-configuration/mcp"

// Lazily-initialized GitHub provider
let githubProvider: ReturnType<typeof createGitHubMcpProvider> | null = null

function getGitHubProvider() {
  if (githubProvider) return githubProvider

  const appId = process.env.GITHUB_APP_ID
  const appSlug = process.env.GITHUB_APP_SLUG
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !appSlug || !privateKey) {
    return null
  }

  githubProvider = createGitHubMcpProvider({ appId, appSlug, privateKey })
  return githubProvider
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
      chat: { select: { user: { select: { githubAppInstallationId: true } } } },
    },
  })

  const out: AgentMcpServer[] = []
  for (const row of rows) {
    if (!row.mcpUrl) continue

    if (row.qualifiedName === GITHUB_MCP_QUALIFIED_NAME) {
      const installationId = row.chat.user.githubAppInstallationId
      const github = getGitHubProvider()
      if (!installationId || !github) {
        // Row exists but App has been uninstalled or not configured — skip
        // silently so the agent doesn't get a row with no usable auth.
        continue
      }
      try {
        const token = await github.getToken(installationId)
        out.push({
          name: safeServerName(row.qualifiedName),
          url: row.mcpUrl,
          bearerToken: token,
        })
      } catch (err) {
        console.error(
          "[agent-servers] failed to mint GitHub installation token:",
          err
        )
      }
      continue
    }

    if (!row.encryptedApiKey) continue
    out.push({
      name: safeServerName(row.qualifiedName),
      url: row.mcpUrl,
      bearerToken: decrypt(row.encryptedApiKey),
    })
  }
  return out
}
