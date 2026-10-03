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
- **Bring your own auth**: per-user API keys, custom OpenAI-compatible endpoints, and Claude/ChatGPT subscription sign-in (no API key needed)
- **Credits & Billing**: per-run token/cost metering with Stripe credit top-ups (optional — off unless `BILLING_ENABLED` is set)
- **Share Links**: publish a read-only view of a conversation at `/share/<shareId>`
- **Admin Dashboard**: usage, cost, and user analytics at `/admin`
- **Dark/Light Theme**: system-aware theming with manual override options

The same app is also packaged as an Electron desktop app — see [`desktop`](../desktop).

## Architecture

- **Frontend**: Next.js 16 with React 19, Tailwind CSS 4, and Radix UI primitives
- **Authentication**: NextAuth.js with GitHub OAuth provider and Prisma adapter
- **Database**: PostgreSQL with Prisma ORM (local, Supabase, or Neon serverless)
- **Agent SDK**: Uses [`@background-agents/sdk`](../sdk) for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **Data Layer**: TanStack React Query (`lib/query/`) over server routes, with localStorage as a read cache for cross-device sync
- **Billing**: Stripe Checkout + webhooks (`app/api/stripe`), feature-flagged behind `BILLING_ENABLED`
- **Metering**: `tokscale` in the sandbox reports per-run tokens/cost into `TokenUsage` / `CreditTransaction`

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

# Strongly recommended in production. `/api/cron/*` and `/api/snapshot/rebuild`
# compare the Authorization header against this value — but when it is UNSET they
# skip the check entirely and are publicly callable.
CRON_SECRET="<random-secret>"
```

Deploys to Vercel via `packages/web/vercel.json`. The `prebuild` script (`scripts/prisma-deploy.mjs`) runs `npx prisma migrate deploy` during the Vercel build to apply migrations to the production database. It connects using the first of `DIRECT_URL`, `POSTGRES_URL_NON_POOLING`, or `DATABASE_URL` that is set, and refuses to run through a transaction pooler (port 6543) because `prisma migrate deploy` takes a session-level advisory lock that hangs behind PgBouncer.

Optional, all off/ignored unless set:

```bash
# Stripe credit top-ups. Leave BILLING_ENABLED unset and the billing routes 404
# while the rest of the app runs normally.
BILLING_ENABLED="true"
STRIPE_SECRET_KEY="sk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."   # differs per environment: CLI, preview, live
# Pack id -> Stripe price id. Price ids don't cross test/live mode, so this map is
# per-environment too. Only packs listed here can be purchased.
STRIPE_PRICE_MAP='{"pack_5":"price_...","pack_10":"price_..."}'

# Whole-site kill switch. MAINTENANCE_MODE="true" serves a maintenance page to
# everyone; append ?bypass=<MAINTENANCE_BYPASS_SECRET> to any URL to set a
# bypass cookie for yourself.
MAINTENANCE_MODE="true"
MAINTENANCE_BYPASS_SECRET="<random-secret>"

# Point the sidebar's docs link somewhere other than https://docs.backgrounder.dev
NEXT_PUBLIC_DOCS_URL="https://docs.example.com"

# Show the built-in keyless Eliza agent in the model picker regardless of the
# per-user setting.
NEXT_PUBLIC_ENABLE_ELIZA="true"
```

`POSTGRES_URL` is accepted as a fallback for `DATABASE_URL` (the Vercel/Neon
integration variable).

#### Shared and operator-supplied credentials

Users normally store their own API keys in the UI (encrypted at rest with
`ENCRYPTION_KEY`). As a fallback, any credential that isn't in the database is read
from the process environment, so an operator can supply a shared key without the UI:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `KIMI_API_KEY`,
`KILO_API_KEY`, `FACTORY_API_KEY`, `COPILOT_GITHUB_TOKEN`, `CLAUDE_CODE_CREDENTIALS`,
`CODEX_CREDENTIALS`, and `OPENCODE_API_KEY` (comma-separated pool — one key is picked
at random per resolution so runs spread across them). The authoritative list is
`CREDENTIAL_KEYS` in `lib/credentials.ts`.

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

#### Unit tests

Unit tests live next to the code they cover (`*.test.ts` / `*.test.tsx`) and run with
Vitest. `vitest.config.ts` excludes `e2e/`, which is Playwright's. Run from
`packages/web/`:

```bash
npx vitest run
```

#### End-to-end tests

End-to-end tests run against a local test database.

> [!WARNING]
> Each E2E run wipes the test database via `prisma migrate reset --force`. As a guard, `DATABASE_URL` must contain `localhost` or `127.0.0.1` — or you must explicitly set `I_KNOW_THIS_IS_THE_TEST_DB=true`.

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
