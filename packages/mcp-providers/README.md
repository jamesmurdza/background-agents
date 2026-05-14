# @upstream/mcp-providers

Framework-agnostic MCP provider abstractions for GitHub and Smithery.

This package provides pure TypeScript implementations for connecting to MCP servers through different providers. It has no web framework dependencies (no Next.js, no Prisma) and can be used by any TypeScript application.

## Providers

### GitHub

Uses GitHub App authentication to mint short-lived installation tokens for GitHub's hosted MCP server at `api.githubcopilot.com/mcp/`.

```typescript
import { createGitHubMcpProvider, GITHUB_MCP_URL } from "@upstream/mcp-providers"

const github = createGitHubMcpProvider({
  appId: process.env.GITHUB_APP_ID!,
  appSlug: process.env.GITHUB_APP_SLUG!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
})

// Mint a token for an installation
const token = await github.getToken(installationId)

// Use with the MCP endpoint
const config = {
  url: GITHUB_MCP_URL, // "https://api.githubcopilot.com/mcp/"
  bearerToken: token,
}

// Invalidate cached token (e.g., on disconnect)
github.invalidateToken(installationId)

// Get the App install URL for users
const installUrl = github.getInstallUrl()
```

### Smithery

Uses Smithery Connect to manage connections with per-server OAuth flows.

```typescript
import {
  createSmitheryProvider,
  getSmitheryConnectionId,
} from "@upstream/mcp-providers"

const smithery = createSmitheryProvider({
  apiKey: process.env.SMITHERY_API_KEY!,
  namespace: process.env.SMITHERY_NAMESPACE, // optional
})

// Generate a deterministic connection ID
const connectionId = getSmitheryConnectionId(chatId, "exa/exa")

// Create or refresh a connection
const result = await smithery.createConnection(
  "https://server.smithery.ai/exa/exa/mcp",
  connectionId,
  "Exa Search"
)

if (result.status === "auth_required") {
  // Redirect user to result.authorizationUrl for OAuth
}

if (result.status === "connected") {
  // Use result.mcpEndpoint with the Smithery API key as bearer token
}

// Check connection status
const status = await smithery.getConnectionStatus(connectionId)

// Delete a connection
await smithery.deleteConnection(connectionId)
```

## Types

```typescript
import type {
  McpServerConfig,
  IMcpProvider,
  ITokenMintingProvider,
  IConnectionProvider,
  ConnectionResult,
  ConnectionStatus,
} from "@upstream/mcp-providers"
```

### McpServerConfig

The common output format that agent CLIs consume:

```typescript
interface McpServerConfig {
  name: string       // Stable identifier (e.g., "github-github")
  url: string        // MCP endpoint URL
  bearerToken: string // Authorization header value
}
```

### Provider Interfaces

- **`ITokenMintingProvider`** — Providers that mint short-lived tokens (GitHub)
- **`IConnectionProvider`** — Providers that manage connection lifecycles (Smithery)

## Utilities

### safeServerName

Sanitize qualified names into CLI-safe identifiers:

```typescript
import { safeServerName } from "@upstream/mcp-providers"

safeServerName("github/github")  // "github-github"
safeServerName("exa/exa")        // "exa-exa"
```

### getSmitheryConnectionId

Generate deterministic connection IDs for Smithery:

```typescript
import { getSmitheryConnectionId } from "@upstream/mcp-providers"

const id = getSmitheryConnectionId("chat-123", "exa/exa")
// "chat-chat-123-exa-exa"
```

## Constants

```typescript
import {
  GITHUB_MCP_URL,           // "https://api.githubcopilot.com/mcp/"
  GITHUB_MCP_QUALIFIED_NAME, // "github/github"
  SMITHERY_API_BASE,        // "https://api.smithery.ai"
} from "@upstream/mcp-providers"
```

## Token Caching

The GitHub provider automatically caches installation tokens and refreshes them 5 minutes before expiry. Tokens are cached in memory — if you need distributed caching, wrap the provider or call `invalidateToken()` on cache invalidation events.

## Dependencies

- `jose` — JWT signing for GitHub App authentication

No other runtime dependencies.
