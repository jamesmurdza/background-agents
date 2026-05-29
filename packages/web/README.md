# Daytona Background Agents Web App

A Next.js chat application for interacting with AI coding agents in isolated Daytona sandboxes. Each chat session is tied to a Git branch, enabling safe code experimentation and collaboration.

https://github.com/user-attachments/assets/d3a10c97-8a23-4171-a08f-c08179b419d6

## Features

- **Multi-Agent Support**: Choose from multiple AI coding agents:
  - Claude Code
  - OpenCode
  - Codex
  - GitHub Copilot
  - Gemini
  - Goose
  - Kilo
  - Pi
  - Eliza (deterministic test agent)

- **Sandbox Isolation**: Each chat session runs in an isolated Daytona sandbox environment

- **Git Integration**: Conversations are tied to Git branches, with optional GitHub repository integration

- **Model Selection**: Choose different models for each agent based on your API keys

- **Scheduled & Triggered Jobs**: Run agents automatically on a recurring interval or in response to GitHub webhook events (e.g. failed workflows), with optional auto-PR creation. Managed from the `/jobs` page.

- **MCP Servers**: Attach Model Context Protocol servers to chats and scheduled jobs via the [Smithery](https://smithery.ai) registry and the GitHub MCP server

- **Skills**: Install repo-scoped agent skills from the [skills.sh](https://skills.sh) marketplace

- **Dark/Light Theme**: System-aware theming with manual override options

## Architecture

- **Frontend**: Next.js 16 with React 19, Tailwind CSS 4, and Radix UI primitives
- **Authentication**: NextAuth.js with GitHub OAuth provider and Prisma adapter
- **Database**: PostgreSQL with Prisma ORM (supports local and Neon serverless)
- **Agent SDK**: Uses `background-agents` for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **State Management**: Server-first with localStorage as read cache for cross-device sync

### Data flow

1. All writes go through the server first (create chat, send message, update settings)
2. Server responds with server-generated IDs
3. Client updates localStorage cache
4. On page load, client fetches fresh data from server and merges with cache
5. Device-specific state (current chat, unseen notifications) stays local-only

## Environment variables

### Development

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/background_agents"
DAYTONA_API_KEY="dtn_your_key_here"
NEXTAUTH_URL="http://localhost:4000"
NEXTAUTH_SECRET="random-string-for-session-jwt"
GITHUB_PAT="ghp_your_token_here"   # enables auto-login; bypasses real OAuth

# Optional: encrypts user-stored API credentials at rest. Generate with: openssl rand -hex 32
ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"

# Required by NextAuth but unused when GITHUB_PAT is set
GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"
```

### Deployment (production)

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

# Optional: Smithery MCP server registry — see ../mcp-providers/README.md
SMITHERY_API_KEY="..."
SMITHERY_NAMESPACE=""

# Optional: GitHub App MCP server — see ../mcp-providers/README.md
GITHUB_APP_ID="..."
GITHUB_APP_SLUG="..."
GITHUB_APP_PRIVATE_KEY="..."
```

### Testing (E2E)

```bash
# DATABASE_URL MUST contain "test", "localhost", or "127.0.0.1" (safety check)
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents_test"
DAYTONA_API_KEY="dtn_..."           # real key — tests create real sandboxes

# Test-mode constants (also set by playwright.config.ts; documented here for `dev:test`)
ENABLE_TEST_AUTH=true
NEXTAUTH_SECRET=test-secret-for-e2e-tests
NEXTAUTH_URL=http://localhost:4000
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder

# Optional: bypass the "is this a test DB?" safety check
# I_KNOW_THIS_IS_THE_TEST_DB=true
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 4000 |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Run Playwright tests with UI |

## Database migrations

| Command | What it does |
|---------|--------------|
| `npx prisma migrate dev --name my_change` | Create + apply a migration |
| `npx prisma migrate status` | Check migration status |
| `npx prisma generate` | Regenerate Prisma client |

**Workflow:**

1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name my_change`
3. Commit the new files in `prisma/migrations/`
4. Push to git

**After pulling:** Run `npx prisma migrate dev` to apply new migrations.

CI/CD runs `npx prisma migrate deploy` to apply migrations to production.
