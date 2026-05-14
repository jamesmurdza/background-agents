# @upstream/mcp-providers

Framework-agnostic MCP provider abstractions for GitHub and Smithery.

This package provides pure TypeScript implementations for connecting to MCP servers. No web framework dependencies.

## GitHub

Mints short-lived installation tokens for GitHub's hosted MCP server.

```typescript
import { createGitHubMcpProvider, GITHUB_MCP_URL } from "@upstream/mcp-providers"

const github = createGitHubMcpProvider({
  appId: process.env.GITHUB_APP_ID!,
  appSlug: process.env.GITHUB_APP_SLUG!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
})

const token = await github.getToken(installationId)
const installUrl = github.getInstallUrl()
github.invalidateToken(installationId)
```

## Smithery

Manages connection lifecycles with per-server OAuth flows.

```typescript
import {
  createSmitheryProvider,
  getSmitheryConnectionId,
} from "@upstream/mcp-providers"

const smithery = createSmitheryProvider({
  apiKey: process.env.SMITHERY_API_KEY!,
  namespace: process.env.SMITHERY_NAMESPACE, // optional
})

const connectionId = getSmitheryConnectionId(chatId, "exa/exa")

const result = await smithery.createConnection(
  "https://server.smithery.ai/exa/exa/mcp",
  connectionId,
  "Exa Search"
)

if (result.status === "auth_required") {
  // Redirect user to result.authorizationUrl
}

if (result.status === "connected") {
  // Use result.mcpEndpoint with the Smithery API key as bearer token
}

await smithery.getConnectionStatus(connectionId)
await smithery.deleteConnection(connectionId)
```

## Types

```typescript
import type {
  McpServerConfig,
  ITokenMintingProvider,
  IConnectionProvider,
  ConnectionResult,
  ConnectionStatus,
} from "@upstream/mcp-providers"
```

## Utilities

```typescript
import { safeServerName } from "@upstream/mcp-providers"

safeServerName("github/github")  // "github-github"
```

## Constants

```typescript
import {
  GITHUB_MCP_URL,           // "https://api.githubcopilot.com/mcp/"
  GITHUB_MCP_QUALIFIED_NAME, // "github/github"
  SMITHERY_API_BASE,        // "https://api.smithery.ai"
} from "@upstream/mcp-providers"
```
