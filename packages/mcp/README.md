# @background-agents/mcp

TypeScript library for connecting to MCP servers via GitHub, Smithery, Paddle, and our own Gmail MCP server.

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

## Gmail

Our own Gmail MCP server, served by the web app at `/api/mcp/gmail`. The agent gets a short-lived connection token, never a Google credential, so the per-connection tool policy can't be bypassed.

```typescript
import {
  createGmailMcpProvider,
  serveGmailMcp,
  parseGmailToolPolicy,
} from "@background-agents/mcp"

const gmail = createGmailMcpProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  jwtSecret: process.env.GMAIL_MCP_JWT_SECRET!,
})

// Linking a Google account (popup flow)
const state = await gmail.signOAuthState(userId)
const authUrl = gmail.getAuthUrl(redirectUri, state)
// ...in the callback:
if ((await gmail.verifyOAuthState(state)) === userId) {
  const refreshToken = await gmail.exchangeCode(code, redirectUri)
}
await gmail.revokeToken(refreshToken) // on disconnect

// Per agent turn: the bearer token for the agent's MCP config
const token = await gmail.signConnectionToken(connectionId)

// In the MCP route: verify, then serve with that connection's policy
const id = await gmail.verifyConnectionToken(bearer) // null if invalid/expired
return serveGmailMcp(req, {
  policy: parseGmailToolPolicy(row.toolPolicy),
  getAccessToken: () => gmail.getAccessToken(userId, refreshToken),
})
```

### Tool policy

| Field | Effect |
|--|--|
| `allowedTools` | Only these tools are registered; others don't exist for the agent |
| `allowedRecipients` | Every To/Cc/Bcc on a send must match an address or `@domain` (drafts are exempt — they aren't sent) |
| `restrictToLabel` | Search, read, reply and relabel only threads with this label |
| `maxResults` | Caps search page size |

Presets: `GMAIL_POLICY_PRESETS.readOnly` (the default for a missing or invalid policy), `readDraft`, and `full`. Client code can import the policy without the server via `@background-agents/mcp/gmail/policy`.

### Google OAuth Setup

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Gmail API**.
2. Configure the OAuth consent screen (External; add yourself as a test user while in Testing) and add the `https://www.googleapis.com/auth/gmail.modify` scope. That one scope covers every tool; the tool policy narrows it per connection.
3. Create an OAuth client of type **Web application** with the redirect URI `<NEXTAUTH_URL>/api/mcp/connect/gmail/callback`.
4. Set the credentials, plus a random secret for signing connection tokens:

```bash
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-..."
# Any random 32+ byte secret, e.g. from `openssl rand -base64 32`
GMAIL_MCP_JWT_SECRET="..."
# Optional: public base URL agents use to reach /api/mcp/gmail. Defaults to
# NEXTAUTH_URL; local dev needs a tunnel since sandboxes can't reach localhost.
GMAIL_MCP_BASE_URL="https://<tunnel>.trycloudflare.com"
```

In Testing mode Google expires refresh tokens after 7 days; publishing the app with Gmail scopes requires Google's verification.

## Paddle

Mints access tokens for Paddle's own hosted MCP server (`mcp.paddle.com/mcp`) via OAuth with PKCE against `id.paddle.com`. Paddle supports public clients (`token_endpoint_auth_method: "none"`), so there's no client secret to hold — only a `clientId`.

```typescript
import { createPaddleMcpProvider, PADDLE_MCP_URL } from "@background-agents/mcp"

const paddle = createPaddleMcpProvider({
  clientId: process.env.PADDLE_CLIENT_ID!,
  jwtSecret: process.env.PADDLE_MCP_JWT_SECRET!,
})

// Linking a Paddle account (popup flow). The signed `authUrl`'s `state`
// carries the PKCE code_verifier, so there's no server-side session to keep.
const authUrl = await paddle.getAuthUrl(redirectUri, userId)
// ...in the callback:
const verified = await paddle.verifyOAuthState(state) // { userId, codeVerifier } | null
if (verified?.userId === userId) {
  const refreshToken = await paddle.exchangeCode(code, redirectUri, verified.codeVerifier)
}

// Per agent turn: mint a fresh access token (cached in-process, refreshed
// lazily like the GitHub installation token)
const token = await paddle.getToken(userId, refreshToken)
```

### Paddle OAuth Setup

1. Register a public OAuth client with Paddle (dynamic client registration at `https://id.paddle.com/oauth2/register`, or ask Paddle support) with redirect URI `<NEXTAUTH_URL>/api/mcp/connect/paddle/callback`, `token_endpoint_auth_method: "none"`, and the `offline_access` scope (needed to get a refresh token back).
2. Set the client id, plus a random secret for signing OAuth state/PKCE verifier pairs:

```bash
PADDLE_CLIENT_ID="..."
# Any random 32+ byte secret, e.g. from `openssl rand -base64 32`
PADDLE_MCP_JWT_SECRET="..."
```

Paddle's sandbox environment (`sandbox-mcp.paddle.com`) has no OAuth option — only a static sandbox API key (`pdl_sdbx_...`) passed as `Authorization: Bearer`. This provider targets the live environment only.

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
  GMAIL_MCP_QUALIFIED_NAME, // "google/gmail"
  SMITHERY_API_BASE,        // "https://api.smithery.ai"
} from "@background-agents/mcp"
```
