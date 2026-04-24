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

Run these from the monorepo root:

| Command | What it does |
|---------|--------------|
| `npm run prisma:migrate -- --name my_change` | Create + apply a migration |
| `npm run prisma:status` | Check migration status |
| `npm run prisma:generate` | Regenerate Prisma client |

**Workflow:**

1. Edit `packages/simple-chat/prisma/schema.prisma`
2. Run `npm run prisma:migrate -- --name my_change`
3. Commit the new files in `prisma/migrations/`
4. Push to git

**After pulling:** Run `npm run prisma:migrate` to apply new migrations.

CI/CD runs `npm run prisma:migrate:deploy` to apply migrations to production.
