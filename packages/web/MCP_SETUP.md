# MCP Servers — developer setup

## Env vars

Add to `packages/web/.env`:

```bash
SMITHERY_API_KEY=sk-smithery-...
SMITHERY_NAMESPACE=                # optional

GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-app-slug
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

---

## Smithery

1. Sign in at [smithery.ai](https://smithery.ai).
2. Create an API key at [smithery.ai/console/api-keys](https://smithery.ai/console/api-keys) → `SMITHERY_API_KEY`.
3. (Optional) Pin a namespace at [smithery.ai/settings/namespaces](https://smithery.ai/settings/namespaces) → `SMITHERY_NAMESPACE`.
4. Smoke test:

   ```bash
   curl -s http://localhost:4000/api/mcp-registry?search=exa | jq '.servers[0]'
   ```

---

## GitHub App

### 1. Create the App

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

### 2. Make the App public

Open the Advanced tab and click **Make public**:

- Personal: `https://github.com/settings/apps/<APP_NAME>/advanced`
- Org: `https://github.com/organizations/<YOUR_ORG>/settings/apps/<APP_NAME>/advanced`

### 3. Set credentials

1. **App ID** (top of settings page) → `GITHUB_APP_ID`.
2. **Slug** (from `github.com/apps/<slug>`) → `GITHUB_APP_SLUG`.
3. **Private key** — click "Generate a private key", then convert the `.pem` to a single line:

   ```bash
   awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' your-key.pem
   ```

   Paste the output into `GITHUB_APP_PRIVATE_KEY="..."`.

### 4. Smoke test

1. `npm run dev`, sign in.
2. Open a chat → MCP modal → **Connect GitHub** → install on your account.
3. Verify:

   ```bash
   curl -s --cookie-jar /tmp/c --cookie /tmp/c \
     http://localhost:4000/api/mcp/connect/github | jq
   # → { "connected": true, "installationId": "..." }
   ```
