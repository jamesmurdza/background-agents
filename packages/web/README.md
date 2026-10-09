# Daytona Background Agents Web App

A Next.js chat application for interacting with AI coding agents in isolated Daytona sandboxes. Each chat session is tied to a Git branch, enabling safe code experimentation and collaboration.

https://github.com/user-attachments/assets/d3a10c97-8a23-4171-a08f-c08179b419d6

## Features

- **Multi-Agent Support**: choose from any agent supported by the [`@background-agents/sdk`](../sdk) SDK
- **Sandbox Isolation**: each chat session runs in an isolated Daytona sandbox environment
- **Git Integration**: conversations are tied to Git branches, with optional GitHub repository integration
- **Model Selection**: choose different models for each agent based on your API keys
- **Scheduled & Triggered Jobs**: run agents automatically on a recurring interval or in response to GitHub webhook events (e.g. failed workflows), with optional auto-PR creation. Managed from the `/jobs` page.
- **MCP Servers**: attach Model Context Protocol servers to chats and scheduled jobs via the [Smithery](https://smithery.ai) registry and the GitHub MCP server
- **Skills**: install repo-scoped agent skills from the [skills.sh](https://skills.sh) marketplace
- **Dark/Light Theme**: system-aware theming with manual override options

## Architecture

- **Frontend**: Next.js 16 with React 19, Tailwind CSS 4, and Radix UI primitives
- **Authentication**: NextAuth.js with GitHub OAuth provider and Prisma adapter
- **Database**: PostgreSQL with Prisma ORM (local, Supabase, or Neon serverless)
- **Agent SDK**: Uses [`@background-agents/sdk`](../sdk) for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **State Management**: Server-first with localStorage as read cache for cross-device sync

### Shared Claude token recovery

Shared Claude runs connect directly to Anthropic. A small SDK runner starts Claude with an access token fetched from `/api/claude-token` and handles Claude's native `oauth_token_refresh` host callback. On an HTTP `401`, Claude asks for the current database token and retries the failed model request inside the same process. The prompt and completed tools are not restarted. Model requests, responses, and streams do not pass through the web app.

Only a signed capability bound to the user, chat, and active background session is sent when creating the run. The credential endpoint checks that scope for every read and returns only a valid access token, with caching disabled. Shared refresh tokens and cookies remain on the server; access tokens are present in the sandbox's runner/Claude memory. The SDK removes a stale subscription credentials file before starting this path. User-owned subscriptions and custom endpoints keep their existing direct behavior.

The endpoint URL defaults to `NEXTAUTH_URL`. For local development, set `CLAUDE_CREDENTIALS_BASE_URL` to a public HTTPS tunnel to this same app, without `/api/claude-token`; Daytona cannot reach your computer's localhost. The endpoint must use the same database and `NEXTAUTH_SECRET` as the server that starts the run, and deployment protection must permit its bearer capability without requiring a browser login. `CLAUDE_GATEWAY_URL` is not used by this implementation.

The runner relies on Claude's internal stream-json OAuth host callback and is pinned to Claude Code **2.1.283**, matching the sandbox image and SDK fallback installer. Shared OAuth setup checks existing sandboxes and installs that exact version when needed; a failed CLI update, runner installation, or conflicting version on `PATH` prevents the turn from starting. The callback is not a public API-key helper setting; verify it with the SDK integration test before changing the SDK and sandbox image pins. Initial token reads and recovery reads have a 15-second timeout. Model streaming has no added web-function duration limit.

The existing cron/admin workflow still owns credential renewal. If the database has no valid token or still holds the rejected token, recovery fails and Claude reports the authentication failure. Already-started response streams are not replayed by the runner.

## Usage

### Development

Run the web app locally against a local Postgres database. Set the following in `.env.local` **at the repo root** (the `npm` scripts below are root scripts that load it):

```bash
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
DAYTONA_API_KEY="dtn_your_key_here"
NEXTAUTH_URL="http://localhost:4000"
NEXTAUTH_SECRET="random-string-for-session-jwt"

# GitHub OAuth (standard sign-in flow; requires a real OAuth app)
GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"
```

> [!IMPORTANT]
> `ENCRYPTION_KEY` defaults to a non-secret dev key. Override with `openssl rand -hex 32` before deploying.

Run from the repo root:

```bash
npm install
npm run prisma:migrate
npm run dev
```

App is at http://localhost:4000.

### Database migration

After editing `packages/web/prisma/schema.prisma`, run from the repo root:

```bash
npm run prisma:migrate
```

This creates a new migration file in `packages/web/prisma/migrations/` (commit it) and applies it to your local DB. Run the same command after pulling to apply migrations others have added.

### Deployment

Deploy the app to Vercel. Uses a real GitHub OAuth app and requires `ENCRYPTION_KEY` for at-rest encryption of user-stored API credentials.

Env:

```bash
DATABASE_URL="postgresql://..."     # production database (may be a pooled connection)

# Migrations must run over a direct/session connection (port 5432), NOT a
# transaction pooler (port 6543). If DATABASE_URL points at a pooler (e.g.
# Supabase or Neon), set the direct connection here so `prisma migrate deploy`
# can take its advisory lock during the Vercel build. `POSTGRES_URL_NON_POOLING`
# (the Neon/Vercel integration variable) is also accepted.
DIRECT_URL="postgresql://...:5432/..."

DAYTONA_API_KEY="dtn_..."
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="<random-secret>"
GITHUB_CLIENT_ID="<github-oauth-app-id>"
GITHUB_CLIENT_SECRET="<github-oauth-app-secret>"

# REQUIRED in production — credential encryption refuses to run without it
ENCRYPTION_KEY="<openssl rand -hex 32>"

# Required for /api/cron/* endpoints (set in Vercel project env)
CRON_SECRET="<random-secret>"
```

Deploys to Vercel via `packages/web/vercel.json`. The `prebuild` script (`scripts/prisma-deploy.mjs`) runs `npx prisma migrate deploy` during the Vercel build to apply migrations to the production database. It connects using the first of `DIRECT_URL`, `POSTGRES_URL_NON_POOLING`, or `DATABASE_URL` that is set, and refuses to run through a transaction pooler (port 6543) because `prisma migrate deploy` takes a session-level advisory lock that hangs behind PgBouncer.

To enable remote MCP servers from the [Smithery](https://smithery.ai) registry, set:

```bash
SMITHERY_API_KEY="..."
SMITHERY_NAMESPACE=""
```

To enable an authenticated GitHub MCP server, set:

```bash
GITHUB_APP_ID="..."
GITHUB_APP_SLUG="..."
GITHUB_APP_PRIVATE_KEY="..."
```

See [`mcp`](../mcp/README.md) for setup.

### Testing

End-to-end tests run against a local test database.

> [!WARNING]
> Each E2E run wipes the test database via `prisma migrate reset --force`. `DATABASE_URL` must contain `localhost` or `127.0.0.1`.

Env — copy `packages/web/.env.test.example` to `packages/web/.env.test` (overrides the dev env from `.env.local`):

```bash
# DATABASE_URL MUST contain "localhost" or "127.0.0.1" (safety check)
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents_test"

# Test-mode constants — Playwright and `npm run dev:test` both read these
ENABLE_TEST_AUTH=true
NEXTAUTH_SECRET=test-secret-for-e2e-tests
NEXTAUTH_URL=http://localhost:4000
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder
```

`ENABLE_TEST_AUTH=true` lets Playwright skip GitHub OAuth and sign in as a test user.

Tests create real sandboxes, so `DAYTONA_API_KEY` is inherited from your Development `.env.local`.

Run from `packages/web/`:

```bash
npm run test:e2e
```

To start a dev server using the same env profile as the end-to-end tests, run from the repo root:

```bash
npm run dev:test
```

This way, you can reproduce a failing test manually in your browser.
