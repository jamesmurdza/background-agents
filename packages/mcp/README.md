# @background-agents/mcp

TypeScript library for connecting to MCP servers via GitHub and Smithery.

## GitHub

Mints short-lived installation tokens for GitHub's hosted MCP server.

```typescript
import { createGitHubMcpProvider, GITHUB_MCP_URL } from "@background-agents/mcp"

const github = createGitHubMcpProvider({
  appId: process.env.GITHUB_APP_ID!,
  appSlug: process.env.GITHUB_APP_SLUG!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
})

const token = await github.getToken(installationId)
const installUrl = github.getInstallUrl()
github.invalidateToken(installationId)
```

### GitHub App Setup

#### 1. Create the App

Open one of:

- Personal: [github.com/settings/apps/new](https://github.com/settings/apps/new)
- Organization: `https://github.com/organizations/<YOUR_ORG>/settings/apps/new`

Fill in:

- **Homepage URL** — anything.
- **Callback URL** — `http://localhost:4000/api/mcp/connect/github/callback`
- **Request user authorization (OAuth) during installation** — ✅
- **Setup URL** — leave blank.
- **Redirect on update** — ✅
- **Webhook → Active** — uncheck.
- **Where can this GitHub App be installed?** — **Any account**.

Permissions (Repository):

| Permission    | Access       |
|---------------|--------------|
| Contents      | Read & write |
| Issues        | Read & write |
| Pull requests | Read & write |
| Metadata      | Read         |

#### 2. Make the App public

Open the Advanced tab and click **Make public**:

- Personal: `https://github.com/settings/apps/<APP_NAME>/advanced`
- Org: `https://github.com/organizations/<YOUR_ORG>/settings/apps/<APP_NAME>/advanced`

#### 3. Set credentials

1. **App ID** (top of settings page) → `GITHUB_APP_ID`.
2. **Slug** (from `github.com/apps/<slug>`) → `GITHUB_APP_SLUG`.
3. **Private key** — click "Generate a private key", then convert the `.pem` to a single line:

   ```bash
   awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' your-key.pem
   ```

   Paste the output into `GITHUB_APP_PRIVATE_KEY="..."`.

## Smithery

Manages connection lifecycles with per-server OAuth flows.

```typescript
import {
  createSmitheryProvider,
  getSmitheryConnectionId,
} from "@background-agents/mcp"

const smithery = createSmitheryProvider({
  apiKey: process.env.SMITHERY_API_KEY!,
  namespace: process.env.SMITHERY_NAMESPACE, // optional
})

// The third argument is the owner-kind prefix, e.g. "chat" or "job".
const connectionId = getSmitheryConnectionId(chatId, "exa/exa", "chat")

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

### Smithery Setup

1. Sign in at [smithery.ai](https://smithery.ai).
2. Create an API key at [smithery.ai/console/api-keys](https://smithery.ai/console/api-keys) → `SMITHERY_API_KEY`.
3. (Optional) Pin a namespace at [smithery.ai/settings/namespaces](https://smithery.ai/settings/namespaces) → `SMITHERY_NAMESPACE`.

## Types

```typescript
import type {
  McpServerConfig,
  IMcpProvider,
  ITokenMintingProvider,
  IConnectionProvider,
  ConnectionResult,
  ConnectionStatus,
} from "@background-agents/mcp"
```

## Utilities

Helper functions for working with MCP servers.

```typescript
import { safeServerName, isSmitheryServer } from "@background-agents/mcp"

// Convert qualified server names (e.g. "github/github") to safe identifiers
// for use in file names, IDs, etc.
safeServerName("github/github")  // "github-github"

// Check whether a URL points at a Smithery-hosted server (server.smithery.ai)
isSmitheryServer("https://server.smithery.ai/foo/mcp")  // true
isSmitheryServer("https://api.githubcopilot.com/mcp/")  // false
```

## Constants

Pre-defined URLs and identifiers for known MCP servers. Use these instead of hardcoding values to ensure consistency across your application.

```typescript
import {
  GITHUB_MCP_URL,           // "https://api.githubcopilot.com/mcp/"
  GITHUB_MCP_QUALIFIED_NAME, // "github/github"
  SMITHERY_API_BASE,        // "https://api.smithery.ai"
} from "@background-agents/mcp"
```
