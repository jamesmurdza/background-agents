# Simple Chat

A Next.js chat application for interacting with AI coding agents in isolated Daytona sandboxes. Each chat session is tied to a Git branch, enabling safe code experimentation and collaboration.

https://github.com/user-attachments/assets/d3a10c97-8a23-4171-a08f-c08179b419d6

## Features

- **Multi-Agent Support**: Choose from multiple AI coding agents:
  - Claude Code
  - OpenCode
  - Codex
  - Gemini
  - Goose
  - Pi

- **Sandbox Isolation**: Each chat session runs in an isolated Daytona sandbox environment

- **Git Integration**: Conversations are tied to Git branches, with optional GitHub repository integration

- **Model Selection**: Choose different models for each agent based on your API keys

- **Dark/Light Theme**: System-aware theming with manual override options

## Prerequisites

- Node.js 18+
- A Daytona API key (from [Daytona dashboard](https://www.daytona.io/))
- PostgreSQL database (local or hosted, e.g., [Neon](https://neon.tech/))
- API keys for the AI providers you want to use (Anthropic, OpenAI, Google, etc.)
- GitHub OAuth app (optional, for GitHub repository integration)

## Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Configure environment variables**:

   Copy the example environment file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Required variables:
   - `DAYTONA_API_KEY` - Your Daytona API key
   - `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://user:pass@localhost:5432/simple_chat`)
   - `ENCRYPTION_KEY` - 32-character secret for encrypting API credentials
   - `NEXTAUTH_SECRET` - A random secret for NextAuth session encryption
   - `NEXTAUTH_URL` - Your app URL (default: `http://localhost:4000`)

   Optional (for GitHub integration):
   - `GITHUB_CLIENT_ID` - GitHub OAuth app client ID
   - `GITHUB_CLIENT_SECRET` - GitHub OAuth app client secret

3. **Set up the database**:

   Generate the Prisma client and run migrations:

   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

4. **Start the development server**:

   ```bash
   npm run dev
   ```

   The app will be available at http://localhost:4000

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 4000 |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Run Playwright tests with UI |

## Architecture

- **Frontend**: Next.js 16 with React 19, Tailwind CSS 4, and Radix UI primitives
- **Authentication**: NextAuth.js with GitHub OAuth provider and Prisma adapter
- **Database**: PostgreSQL with Prisma ORM (supports local and Neon serverless)
- **Agent SDK**: Uses `background-agents` for agent session management
- **Sandbox**: Daytona SDK for isolated development environments
- **State Management**: Server-first with localStorage as read cache for cross-device sync

## Database

The app uses PostgreSQL to store user data, chats, and messages. This enables:

- **Cross-device sync**: Your chats are available on any device you sign into
- **Server-generated IDs**: All entities have server-generated IDs for consistency
- **Encrypted credentials**: API keys are stored encrypted (AES) in the database

### Schema

- **User**: GitHub OAuth user with settings (JSONB) and encrypted credentials (JSONB)
- **Chat**: Conversation tied to a repo/branch with sandbox info
- **Message**: Individual messages with tool calls and content blocks

### Data Flow

1. All writes go through the server first (create chat, send message, update settings)
2. Server responds with server-generated IDs
3. Client updates localStorage cache
4. On page load, client fetches fresh data from server and merges with cache
5. Device-specific state (current chat, unseen notifications) stays local-only

### Migrations

Prisma manages database schema changes through migrations. The `DATABASE_URL` environment variable determines which database Prisma connects to - there's no automatic "local vs production" detection.

**Environment setup:**

```bash
# .env.local (for local development)
DATABASE_URL="postgresql://postgres:password@localhost:5432/simple_chat"

# .env.production (for production - e.g., Neon)
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/simple_chat?sslmode=require"
```

Prisma reads `DATABASE_URL` from your environment. Whichever `.env` file is loaded (or whichever value is set in your shell/CI) determines the target database.

**Development workflow (local database):**

```bash
# Make sure DATABASE_URL points to your LOCAL database, then:

# After changing prisma/schema.prisma, create and apply a migration:
npx prisma migrate dev --name describe_your_change

# This will:
# 1. Generate a new migration file in prisma/migrations/
# 2. Apply it to your LOCAL database (per DATABASE_URL)
# 3. Regenerate the Prisma client
```

**Production deployment:**

```bash
# In production (Vercel, Railway, etc.), DATABASE_URL should be set to your
# production database. Then run:

npx prisma migrate deploy

# This applies pending migrations to whatever DATABASE_URL points to.
# It's non-interactive and safe for CI/CD - won't create new migrations.
```

**Typical workflow:**

1. Develop locally with `DATABASE_URL` pointing to local PostgreSQL
2. Run `npx prisma migrate dev --name my_change` to create + apply migration locally
3. Commit the migration files in `prisma/migrations/`
4. Push to git
5. In CI/CD or production deploy, `DATABASE_URL` points to production DB
6. Run `npx prisma migrate deploy` to apply the committed migrations

**After pulling changes:**

```bash
# If teammates added migrations, apply them to your local DB:
npx prisma migrate dev

# Or if you just need to sync the Prisma client (no schema changes):
npx prisma generate
```

**Checking migration status:**

```bash
# See which migrations have been applied to the current DATABASE_URL:
npx prisma migrate status
```

**Important:**
- `DATABASE_URL` is the ONLY thing that determines which database is used
- Never edit migration files after they've been committed
- Always commit migration files to git (`prisma/migrations/`)
- Run `migrate dev` locally before pushing schema changes
- Use `migrate deploy` in production/CI - never `migrate dev`
- Double-check your `DATABASE_URL` before running migrations!
