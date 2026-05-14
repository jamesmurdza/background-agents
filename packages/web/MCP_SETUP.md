# MCP Servers — developer setup

The web app exposes MCP (Model Context Protocol) servers to agents through two paths:

- **Smithery** — registry browsing + connection lifecycle for any remote MCP server hosted on `server.smithery.ai`. Used for: Exa, Tavily, Notion, Linear, etc.
- **GitHub App** — our own GitHub App that mints short-lived installation tokens against GitHub's hosted MCP at `api.githubcopilot.com/mcp/`. Used only for GitHub.

Both integrations are surfaced in the per-chat `McpServersModal` (Connected / Browse tabs).

---

## TL;DR — env vars you need

Add these to `packages/web/.env` on top of the base vars from [DEVELOPMENT.md](../../DEVELOPMENT.md):

```bash
# Smithery (registry + connection broker)
SMITHERY_API_KEY=sk-smithery-...
# Optional. If unset, resolved from the API key's first namespace, else
SMITHERY_NAMESPACE=

# GitHub App (hosted MCP via installation tokens)
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-app-slug
# PEM — single line with literal \n between rows is fine.
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Without `SMITHERY_API_KEY`, the registry/connect routes return `503 server config error` — see [`lib/db/api-helpers`](./lib/db/api-helpers.ts).

Without the three `GITHUB_APP_*` vars, the GitHub tile in the modal stays disabled and `/api/mcp/connect/github` returns `503`.

---

## Smithery setup

### 1. Get an API key

1. Sign in at [smithery.ai](https://smithery.ai).
2. Create an API key at [smithery.ai/console/api-keys](https://smithery.ai/console/api-keys).
3. Put it in `SMITHERY_API_KEY`.

### 2. Pin a namespace

By default the resolver picks the first namespace owned by the key, or creates `upstream-<8charHash>` if none exist. See [`lib/mcp/smithery-connect.ts`](./lib/mcp/smithery-connect.ts) `getNamespace()`.

Manage your namespaces at [smithery.ai/settings/namespaces](https://smithery.ai/settings/namespaces).

Set `SMITHERY_NAMESPACE` only when you want every dev/staging/prod env to share a known namespace. Names are globally unique on Smithery, so coordinate before pinning.

### 3. Smoke test

```bash
# from packages/web
curl -s http://localhost:4000/api/mcp-registry?search=exa | jq '.servers[0]'
```

Should return a server object. If it 500s/503s, check `SMITHERY_API_KEY` and the server logs.

---

## GitHub App setup

We do **not** use OAuth for the GitHub MCP. We use a GitHub App so each user installs it on their own account/orgs, and the server mints fresh 1-hour installation tokens per agent turn.

### 1. Create the App

Open one of:

- Personal account: [github.com/settings/apps/new](https://github.com/settings/apps/new)
- Organization: `https://github.com/organizations/<YOUR_ORG>/settings/apps/new` (replace `<YOUR_ORG>` with your org login)

Fill in:

- **Homepage URL** — anything (e.g. your dev URL).
- **Callback URL** — `<NEXTAUTH_URL>/api/mcp/connect/github/callback`
  - Local dev: `http://localhost:4000/api/mcp/connect/github/callback`
  - Daytona proxy: `https://4000-<sandbox-id>.daytonaproxy01.net/api/mcp/connect/github/callback`
- **Request user authorization (OAuth) during installation** — ✅ check this (directly below the Callback URL).
- **Setup URL** — leave blank (we use the Callback URL above for the post-install redirect).
- **Redirect on update** — checked.
- **Webhook** — uncheck "Active" (we don't consume webhooks yet).
- **Where can this GitHub App be installed?** — select **Any account**. Anyone (user or org) who signs in to the app needs to be able to install it on their own account; "Only on this account" would lock installs to whoever owns the App.

**Permissions** (Repository):

| Permission | Access |
|------------|--------|
| Contents | Read & write |
| Issues | Read & write |
| Pull requests | Read & write |
| Metadata | Read |

Account-level: none required.

Anything beyond this is wasted scope — only add more if you're explicitly extending the GitHub MCP surface.

### 2. Make the App public

By default a newly-created App is **private** (only installable by the owning account/org). To let any GitHub user install it, open the Advanced tab:

- Personal account: `https://github.com/settings/apps/<APP_NAME>/advanced`
- Organization: `https://github.com/organizations/<YOUR_ORG>/settings/apps/<APP_NAME>/advanced`

Click **Make public**. Without this, end users will get "this app is private" when they hit the install URL.

### 3. Grab the credentials

After creating the app:

1. **App ID** — top of the App settings page → `GITHUB_APP_ID`.
2. **Public link / slug** — from the App's public URL `github.com/apps/<slug>` → `GITHUB_APP_SLUG`.
3. **Private key** — "Generate a private key" at the bottom of the settings page, downloads a `.pem`.

Convert the PEM to a single-line env var (Bash):

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' your-key.pem
```

Paste the output into `GITHUB_APP_PRIVATE_KEY="..."` (keep the surrounding quotes). Both literal `\n` and real multi-line PEMs are accepted — see [`lib/github/app.ts`](./lib/github/app.ts) `getPrivateKey()`.

### 4. Local install + smoke test

1. Start `npm run dev` and sign in.
2. Open a chat → MCP modal → "Connect GitHub" → install on your account.
3. GitHub redirects to the callback, popup closes, modal flips to Connected.
4. Verify:

```bash
curl -s --cookie-jar /tmp/c --cookie /tmp/c \
  http://localhost:4000/api/mcp/connect/github | jq
# → { "connected": true, "installationId": "..." }
```

5. Send a message in the chat — the agent should now see GitHub MCP tools (`list_issues`, `create_pr`, etc.).

If the agent silently doesn't see GitHub tools, check:

- `User.githubAppInstallationId` is populated (`select id, "githubAppInstallationId" from "User"`).
- `ChatMcpServer` has a row with `qualifiedName='github/github'` and `status='connected'` for this chat.
- Server logs for `[agent-servers] failed to mint GitHub installation token:` — usually a stale/revoked installation.

---

## Database — what each integration writes

Schema in [`prisma/schema.prisma`](./prisma/schema.prisma). Relevant fields:

`User`:
- `githubAppInstallationId` — set on App install, cleared on `DELETE /api/mcp/connect/github`.

`ChatMcpServer` (one row per (chat, qualifiedName)):
- Smithery rows: `smitheryConnectionId`, `smitheryNamespace`, `encryptedApiKey`, `mcpUrl` (Smithery Connect endpoint).
- GitHub row: `qualifiedName='github/github'`, `mcpUrl='https://api.githubcopilot.com/mcp/'`, no encrypted key (token minted per-turn).

Smithery columns are nullable since the GitHub-App migration — see [`prisma/migrations/20260513100000_add_github_app_and_nullable_smithery_fields`](./prisma/migrations/20260513100000_add_github_app_and_nullable_smithery_fields/migration.sql).

---

## Common gotchas

- **PEM env var on Windows**: PowerShell strips real newlines from `.env`. Keep `GITHUB_APP_PRIVATE_KEY` as one line with `\n` separators.
- **`NEXTAUTH_URL` mismatch**: if you're behind a Daytona proxy, the App's Setup URL must use the proxy URL, not `localhost`. NextAuth + the popup `postMessage` both validate origin.
- **Namespace collisions**: Smithery namespace names are globally unique. Don't hard-code `SMITHERY_NAMESPACE` to a friendly name without claiming it first — you'll get `409` from `PUT /namespaces/<name>`.
- **Re-install loop**: if a user removes the App on github.com without calling our `DELETE`, the next turn fails to mint a token. The row stays as `connected`; the agent just gets no tools. Hitting "Disconnect" in the modal cleans this up.

---
