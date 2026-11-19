# @background-agents/mcp

Give a coding agent (Claude Code, Codex, OpenCode, ...) access to MCP servers on behalf of your users: hosted servers from Linear, Notion, Sentry and other vendors, GitHub's MCP server, and a Gmail MCP server with per-connection tool limits.

## How it works

An agent reaches an MCP server over HTTP with a bearer token. This package gets you that token. Each kind of server works a little differently:

| Kind | Who runs the server | How the user connects | What you store |
|--|--|--|--|
| [Vendor servers](#vendor-servers) | The vendor (e.g. `mcp.linear.app`) | OAuth login on the vendor's site | One OAuth client per vendor, and each user's refresh token |
| [GitHub](#github) | GitHub (`api.githubcopilot.com/mcp/`) | Installs your GitHub App | Each user's installation id |
| [Gmail](#gmail) | You (this package serves it) | Google OAuth | Each user's Google refresh token |

Every one ends up as the same thing in the agent's MCP config: a URL and a bearer token.

The package never stores anything. You keep clients and tokens in your own database, encrypted.

```bash
npm install @background-agents/mcp
```

## Vendor servers

These vendors host their own MCP server and let a new app register itself as an OAuth client, so you don't set anything up with them first:

| Vendor | Slug | The agent can |
|--|--|--|
| Linear | `linear` | Work with issues, projects and cycles |
| Notion | `notion` | Search, read and edit pages |
| Sentry | `sentry` | Look at errors, issues and releases |
| Atlassian | `atlassian` | Work with Jira issues and Confluence pages |
| Supabase | `supabase` | Manage projects, databases and edge functions |
| Neon | `neon` | Manage Postgres projects and branches, run SQL |
| Cloudflare | `cloudflare` | Manage Workers, KV, R2 and D1 |
| Hugging Face | `huggingface` | Search models, datasets and Spaces |
| monday.com | `monday` | Work with boards and items |
| Exa | `exa` | Search the web and fetch pages |
| Context7 | `context7` | Look up current library documentation |
| Paddle | `paddle` | Work with billing, subscriptions and customers |

Each one was tested with a real login. Not listed: Figma, Intercom, Vercel and Canva only accept clients or redirect URIs they've approved, and Slack, Asana, HubSpot and Google need an app registered with them by hand.

### Connect a user

```typescript
import { createVendorOAuth, findMcpVendor } from "@background-agents/mcp"

const oauth = createVendorOAuth({
  clientName: "My App", // shown on the vendor's consent screen
  stateSecret: process.env.MCP_OAUTH_STATE_SECRET!, // any random 32+ byte string
})

const linear = findMcpVendor("linear")!
const redirectUri = "https://myapp.com/oauth/linear/callback"

// Once per vendor and redirect URI, shared by all your users. Save it.
const client = await oauth.registerClient(linear, { redirectUri })

// 1. Send the user to the vendor to approve access.
const url = await oauth.authorizationUrl(linear, client, { redirectUri, userId })

// 2. In your callback route, with the `code` and `state` query parameters:
const { userId, tokens } = await oauth.handleCallback(linear, client, {
  redirectUri,
  code,
  state,
})
// Save tokens.refreshToken (and tokens.accessToken + tokens.expiresAt) for userId.
```

The `state` is encrypted with `stateSecret` and carries the user id and the PKCE verifier, so `handleCallback` can check who started the login without you keeping any session for it. It's encrypted, not just signed, because it comes back in the callback URL next to the code.

### Give the agent a token

```typescript
let { accessToken, expiresAt } = saved

if (expiresAt - Date.now() < 5 * 60_000) {
  const tokens = await oauth.refresh(linear, client, saved.refreshToken)
  // Save tokens.refreshToken right away: vendors rotate it on every refresh,
  // and the old one stops working.
  accessToken = tokens.accessToken
}

const server = { name: "linear", url: linear.mcpUrl, bearerToken: accessToken }
```

A few things to get right:

- **Reuse the access token until it's about to expire.** Lifetimes range from an hour (Sentry, Neon, Exa, Cloudflare) to two weeks (Context7).
- **Refresh once at a time per user and vendor.** If two runs refresh with the same refresh token, the second fails, and some vendors then revoke the whole login. Hold a short lock around `refresh`, and have other runs wait for the new token.
- **Handle a lost login.** `refresh` throws an `McpOAuthError`. With `error.code === "invalid_grant"` the user revoked access (or the login expired): delete their tokens and ask them to connect again. With `"invalid_client"` the vendor no longer knows your client: register a new one.

Some vendors (Supabase, Neon, Hugging Face, monday.com) issue a client secret at registration. It comes back on `client.clientSecret`; store it encrypted with the client.

### Lower-level functions

`createVendorOAuth` wraps these, which you can also call directly: `discoverOAuthMetadata`, `registerOAuthClient`, `buildAuthorizationUrl`, `exchangeAuthorizationCode`, `refreshAccessToken`, `createPkcePair`, `signOAuthState` and `verifyOAuthState`. They follow the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization): protected resource metadata, dynamic client registration, PKCE and the `resource` parameter.

## GitHub

Mints short-lived installation tokens for GitHub's hosted MCP server. The user connects by installing your GitHub App; you store the installation id.

```typescript
import { createGitHubMcpProvider, GITHUB_MCP_URL } from "@background-agents/mcp"

const github = createGitHubMcpProvider({
  appId: process.env.GITHUB_APP_ID!,
  appSlug: process.env.GITHUB_APP_SLUG!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
})

const installUrl = github.getInstallUrl() // send the user here to install the app
const token = await github.getToken(installationId) // per agent run; valid for an hour
github.invalidateToken(installationId) // on disconnect

const server = { name: "github", url: GITHUB_MCP_URL, bearerToken: token }
```

### GitHub App setup

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

A Gmail MCP server you host yourself. The agent gets a short-lived connection token, never a Google credential, so the per-connection tool policy can't be bypassed. Google has no "drafts only" permission, so limits like "read and draft, never send" have to be enforced by a server like this one.

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

// In your MCP route: verify, then serve with that connection's policy
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

### Google OAuth setup

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Gmail API**.
2. Configure the OAuth consent screen (External; add yourself as a test user while in Testing) and add the `https://www.googleapis.com/auth/gmail.modify` scope. That one scope covers every tool; the tool policy narrows it per connection.
3. Create an OAuth client of type **Web application** with the redirect URI `<NEXTAUTH_URL>/api/mcp/connect/gmail/callback`.

In Testing mode Google expires refresh tokens after 7 days; publishing the app with Gmail scopes requires Google's verification.

## In Backgrounder

The web app (`packages/web`) uses this package like this:

- **Vendors:** `/api/mcp/connect/<slug>` starts and finishes the login. Clients live in `McpOAuthClient` (one per vendor and redirect URI) and logins in `McpCredential` (one per user and integration), both encrypted. `lib/mcp/vendors.ts` holds the refresh lock.
- **GitHub and Gmail:** same `McpCredential` table, keyed `github` (installation id) and `gmail` (Google refresh token).
- **Per run:** `lib/mcp/agent-servers.ts` turns a chat's or job's attached servers into `{ name, url, bearerToken }` for the agent.

Environment variables:

```bash
# Vendor servers: encrypts the OAuth state. Any random 32+ byte string,
# e.g. from `openssl rand -base64 32`.
MCP_OAUTH_STATE_SECRET="..."

# GitHub (see GitHub App setup)
GITHUB_APP_ID="..."
GITHUB_APP_SLUG="..."
GITHUB_APP_PRIVATE_KEY="..."

# Gmail (see Google OAuth setup)
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-..."
GMAIL_MCP_JWT_SECRET="..." # any random 32+ byte string
# Optional: public base URL agents use to reach /api/mcp/gmail. Defaults to
# NEXTAUTH_URL; local dev needs a tunnel since sandboxes can't reach localhost.
GMAIL_MCP_BASE_URL="https://<tunnel>.trycloudflare.com"
```

## Utilities

```typescript
import { safeServerName } from "@background-agents/mcp"

// Turn a qualified name (e.g. "github/github") into a name every agent CLI accepts.
safeServerName("github/github") // "github-github"
```
