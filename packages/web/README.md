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
- **Database**: PostgreSQL with Prisma ORM (supports local and Neon serverless)
- **Agent SDK**: Uses [`@background-agents/sdk`](../sdk) for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **State Management**: Server-first with localStorage as read cache for cross-device sync

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

After editing `prisma/schema.prisma`, run from the repo root:

```bash
npm run prisma:migrate
```

This creates a new migration file in `prisma/migrations/` (commit it) and applies it to your local DB. Run the same command after pulling to apply migrations others have added.

### Deployment

Deploy the app to Vercel. Uses a real GitHub OAuth app and requires `ENCRYPTION_KEY` for at-rest encryption of user-stored API credentials.

Env:

```bash
DATABASE_URL="postgresql://..."     # production database
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

Deploys to Vercel via `vercel.json`. The `prebuild` script (`scripts/prisma-deploy.mjs`) runs `npx prisma migrate deploy` during the Vercel build to apply migrations to the production database.

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

See [`mcp-providers`](../mcp-providers/README.md) for setup.

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
