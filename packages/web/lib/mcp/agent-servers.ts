/**
 * Load an owner's connected MCP servers in the shape `setupMcpForAgent` wants.
 *
 * Three kinds of rows:
 *   - GitHub row     → mint a fresh installation token via getInstallationToken
 *                      (tokens are 1-hour, so we re-mint on every turn instead
 *                      of trying to keep them in sync with the DB).
 *   - Gmail row      → sign a 1-hour connection token for our own Gmail MCP
 *                      server, which enforces the row's tool policy. The agent
 *                      never gets the Google credential.
 *   - Vendor rows    → (Linear, Notion, ... see MCP_VENDORS) the user's stored
 *                      access token, refreshed when it's about to expire.
 *
 * The user's logins come from McpCredential (see ./credentials).
 *
 * Chats and scheduled jobs share the same McpServerConnection table; the
 * loader takes an `McpOwner` and filters on the right FK column. On GitHub
 * token mint failure (or a missing Google link) we update the row's
 * `lastError`/`status` so the UI can surface "GitHub App uninstalled" on the
 * next form open — important for scheduled jobs that may run days after
 * being configured.
 */
import { prisma } from "@/lib/db/prisma"
import {
  createGitHubMcpProvider,
  GITHUB_MCP_QUALIFIED_NAME,
  GMAIL_MCP_QUALIFIED_NAME,
  findMcpVendorByQualifiedName,
  safeServerName,
} from "@background-agents/mcp"
import type { AgentMcpServer } from "@background-agents/agent-configuration/mcp"
import { type McpOwner, ownerWhere } from "./owner"
import { GITHUB_CREDENTIAL, GMAIL_CREDENTIAL } from "./credentials"
import { getGmailMcpUrl, getGmailProvider } from "./gmail"
import { getVendorAccessToken } from "./vendors"

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

/**
 * Update the row's lastError/status. Best-effort — failure to record a
 * warning shouldn't tank the turn.
 */
async function markRowError(rowId: string, message: string): Promise<void> {
  try {
    await prisma.mcpServerConnection.update({
      where: { id: rowId },
      data: { status: "error", lastError: message },
    })
  } catch (err) {
    console.error("[agent-servers] failed to mark row error:", err)
  }
}

interface McpRow {
  id: string
  qualifiedName: string
  mcpUrl: string | null
}

/** The owner's user, with the GitHub and Gmail logins those rows depend on. */
interface OwnerUser {
  id: string
  mcpCredentials: { provider: string; installationId: string | null }[]
}

/**
 * Translate one DB row to the AgentMcpServer shape the sandbox loader expects.
 * Returns null when the row can't produce a usable connection.
 */
async function translateRow(
  row: McpRow,
  user: OwnerUser | null
): Promise<AgentMcpServer | null> {
  if (!row.mcpUrl) return null

  if (row.qualifiedName === GMAIL_MCP_QUALIFIED_NAME) {
    const gmail = getGmailProvider()
    if (!gmail) {
      await markRowError(row.id, "Gmail not configured on server")
      return null
    }
    if (!user?.mcpCredentials.some((c) => c.provider === GMAIL_CREDENTIAL)) {
      await markRowError(row.id, "Google account not connected for this user")
      return null
    }
    // Computed per turn rather than read from the row, so a changed base URL
    // (e.g. a new dev tunnel) applies to existing connections.
    return {
      name: safeServerName(row.qualifiedName),
      url: getGmailMcpUrl(),
      bearerToken: await gmail.signConnectionToken(row.id),
    }
  }

  if (row.qualifiedName === GITHUB_MCP_QUALIFIED_NAME) {
    const installationId =
      user?.mcpCredentials.find((c) => c.provider === GITHUB_CREDENTIAL)?.installationId ?? null
    const github = getGitHubProvider()
    if (!github) {
      await markRowError(row.id, "GitHub App not configured on server")
      return null
    }
    if (!installationId) {
      await markRowError(row.id, "GitHub App not installed for this user")
      return null
    }
    try {
      const token = await github.getToken(installationId)
      return {
        name: safeServerName(row.qualifiedName),
        url: row.mcpUrl,
        bearerToken: token,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to mint token"
      console.error(
        "[agent-servers] failed to mint GitHub installation token:",
        err
      )
      await markRowError(row.id, `GitHub token mint failed: ${msg}`)
      return null
    }
  }

  const vendor = findMcpVendorByQualifiedName(row.qualifiedName)
  if (vendor) {
    if (!user) {
      await markRowError(row.id, `${vendor.name} account not connected for this user`)
      return null
    }
    try {
      return {
        name: safeServerName(row.qualifiedName),
        // From the vendor list rather than the row, so a changed URL applies
        // to existing connections.
        url: vendor.mcpUrl,
        bearerToken: await getVendorAccessToken(user.id, vendor),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get access token"
      console.error(`[agent-servers] failed to get ${vendor.name} access token:`, msg)
      await markRowError(row.id, msg)
      return null
    }
  }

  return null
}

/**
 * Load the MCP servers attached to either a chat or a scheduled job. The
 * user's GitHub and Gmail logins are read through the owner's user relation
 * regardless of the owner kind.
 */
const ownerUserSelect = {
  id: true,
  mcpCredentials: {
    where: { provider: { in: [GITHUB_CREDENTIAL, GMAIL_CREDENTIAL] as string[] } },
    select: { provider: true, installationId: true },
  },
} as const

export async function loadMcpConnections(
  owner: McpOwner
): Promise<AgentMcpServer[]> {
  const rows = await prisma.mcpServerConnection.findMany({
    where: { ...ownerWhere(owner), status: "connected" },
    select: {
      id: true,
      qualifiedName: true,
      mcpUrl: true,
      chat: { select: { user: { select: ownerUserSelect } } },
      scheduledJob: { select: { user: { select: ownerUserSelect } } },
    },
  })

  const out: AgentMcpServer[] = []
  for (const row of rows) {
    const user = row.chat?.user ?? row.scheduledJob?.user ?? null
    const translated = await translateRow(row, user)
    if (translated) out.push(translated)
  }
  return out
}

