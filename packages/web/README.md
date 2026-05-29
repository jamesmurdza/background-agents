# Daytona Background Agents Web App

A Next.js chat application for interacting with AI coding agents in isolated Daytona sandboxes. Each chat session is tied to a Git branch, enabling safe code experimentation and collaboration.

https://github.com/user-attachments/assets/d3a10c97-8a23-4171-a08f-c08179b419d6

## Features

- **Multi-Agent Support**: choose from any agent supported by the [`background-agents`](../agents) SDK
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
- **Agent SDK**: Uses [`background-agents`](../agents) for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **State Management**: Server-first with localStorage as read cache for cross-device sync

## Usage

### Development

Runs the web app locally against a local Postgres database. `GITHUB_PAT` enables auto-login so no GitHub OAuth app is required for dev.

Env (`.env.local`):

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/background_agents"
DAYTONA_API_KEY="dtn_your_key_here"
NEXTAUTH_URL="http://localhost:4000"
NEXTAUTH_SECRET="random-string-for-session-jwt"

# Option 1: GitHub OAuth
GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"

# Option 2: GitHub PAT
GITHUB_PAT="ghp_your_token_here"   # enables auto-login; bypasses real OAuth
```

`ENCRYPTION_KEY` (encrypts user-stored API credentials at rest) defaults to a built-in dev key. To override, set it to a real value — generate with `openssl rand -hex 32`.

Run:

```bash
npm install
npx prisma migrate dev
npm run dev
```

App is at http://localhost:4000. With `GITHUB_PAT` set you get auto-login — no GitHub OAuth app required.

### Database migration

After editing `prisma/schema.prisma`, generate a migration file and apply it to your local DB. Commit the resulting files in `prisma/migrations/`.

```bash
npx prisma migrate dev
```

After pulling new migrations from git, run the same command to apply them.

### Deployment

Production deployment to Vercel. Uses a real GitHub OAuth app and requires `ENCRYPTION_KEY` so user-stored API credentials are encrypted at rest.

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

Deploys to Vercel via `vercel.json`. CI runs `npx prisma migrate deploy` to apply migrations to the production database.

**Smithery MCP server registry** — lets users browse and connect remote MCP servers from the [Smithery](https://smithery.ai) registry inside chats. Setup details in [../mcp-providers/README.md](../mcp-providers/README.md).

```bash
SMITHERY_API_KEY="..."
SMITHERY_NAMESPACE=""
```

**GitHub App MCP server** — gives chats and scheduled jobs an authenticated GitHub MCP server scoped to the user's installations (issues, PRs, code search). Setup details in [../mcp-providers/README.md](../mcp-providers/README.md).

```bash
GITHUB_APP_ID="..."
GITHUB_APP_SLUG="..."
GITHUB_APP_PRIVATE_KEY="..."
```

### Testing

End-to-end tests run against a local test database. Each run resets the database via `prisma migrate reset --force`, so the safety check refuses any non-local `DATABASE_URL`.

Env (`.env.test` in this package) — overrides the dev env from `.env.local`:

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

Set `I_KNOW_THIS_IS_THE_TEST_DB=true` to bypass the safety check and let E2E run against a `DATABASE_URL` that isn't localhost — only do this if you know what you're doing.

`DAYTONA_API_KEY` is inherited from your Development `.env.local` — tests create real sandboxes.

Run:

```bash
npm run test:e2e
```

Each run resets the test database via `prisma migrate reset --force`.

To debug a failing test, start a dev server using the same env profile as Playwright (test DB, test-auth route, placeholder OAuth) so you can reproduce the failure manually in your browser:

```bash
npm run dev:test
```
