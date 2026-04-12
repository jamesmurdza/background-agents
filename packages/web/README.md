# @upstream/web

A multi-tenant web application that enables users to run AI coding agents (Claude Code, OpenCode, Codex, Gemini, Goose, Pi) in isolated Daytona sandboxes. Features a Slack-like interface for managing AI-powered coding agents across multiple GitHub repositories with real-time streaming output, background execution, and persistent chat history.

<img width="1361" height="749" alt="image" src="https://github.com/user-attachments/assets/301f461c-7a8a-43b3-b26b-c30d3b972dcf" />

## Features

### Core Capabilities
- **Multi-Agent Support** - Run Claude Code, OpenCode, or Codex agents with configurable models
- **GitHub OAuth Login** - Sign in with GitHub, OAuth tokens used for seamless repo access
- **Isolated Sandboxes** - Each branch gets its own Daytona sandbox environment
- **Real-time Streaming** - Live agent output via Server-Sent Events (SSE)
- **Background Execution** - Agent tasks continue even when browser is closed
- **Persistent Chat History** - Full conversation history with tool calls and content blocks

### User Experience
- **Slack-like Interface** - Repository sidebar with branch-based conversations
- **Multi-tenant Architecture** - User data fully isolated, shared infrastructure
- **Quota Enforcement** - Configurable concurrent sandbox limits
- **Encrypted Credentials** - API keys stored AES-encrypted in database
- **Drag-and-Drop Reordering** - Customize repository order in sidebar
- **Dark Mode Support** - Theme switching with next-themes
- **Mobile Responsive** - Full mobile UI with drawer navigation

### Developer Features
- **Pull Request Integration** - Create PRs directly from branches
- **Git Diff Viewer** - Compare branches and view changes
- **Git History** - Browse commit history per branch
- **Advanced Git Operations** - Merge, rebase, reset, rename, and delete remote branches
- **MCP Server Registry** - Browse and connect 3,000+ MCP servers via [Smithery](https://smithery.ai)
- **Environment Variables** - Per-repository encrypted env vars for sandboxes
- **Auto-Stop** - Configurable sandbox auto-stop intervals (5-20 minutes)
- **Safe Push Handling** - Branch checks plus retry and graceful "already up-to-date" handling

---

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   Browser (React)   │────▶│   Next.js 16 API    │────▶│   Neon Postgres  │
│   - Shadcn/ui       │◀────│   (Vercel/Node)     │◀────│   (Serverless)   │
│   - SSE Streaming   │     │   - 34 API routes   │     │   - Prisma ORM   │
└─────────────────────┘     └──────────┬──────────┘     └──────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
          ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
          │  Daytona Cloud  │ │   GitHub API    │ │   LLM APIs      │
          │  (Sandboxes)    │ │   (OAuth)       │ │   - Anthropic   │
          │  - SDK control  │ │   - Repos/PRs   │ │   - OpenAI      │
          └────────┬────────┘ └─────────────────┘ └─────────────────┘
                   │
                   ▼
          ┌─────────────────┐         ┌─────────────────┐
          │  Coding Agents  │────────▶│  Smithery       │
          │  - Claude Code  │         │  (MCP Registry  │
          │  - OpenCode     │◀────────│   + Connect)    │
          │  - Codex        │         └─────────────────┘
          └─────────────────┘
```

---

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router, React 19)
- **UI Library**: Shadcn/ui (50+ Radix UI components)
- **Styling**: Tailwind CSS 4
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React
- **Charts**: Recharts
- **Notifications**: Sonner toast notifications
- **Markdown**: react-markdown for agent output

### Backend
- **Server**: Next.js API Routes (serverless)
- **ORM**: Prisma with Neon adapter
- **Database**: PostgreSQL (Neon serverless)
- **Authentication**: NextAuth.js (GitHub OAuth)
- **Encryption**: crypto-js (AES encryption)

### External Services
- **Sandboxes**: Daytona SDK (@daytonaio/sdk)
- **Agent Runner**: @upstream/agents
- **LLM Providers**: Anthropic SDK, OpenAI SDK
- **MCP Registry**: [Smithery](https://smithery.ai) (server discovery + managed connections)

---

## Setup

### Prerequisites

- Node.js 18+
- A Vercel account (for deployment + Neon integration)
- A GitHub account (for OAuth app)
- A Daytona API key

### 1. Neon Database

**Option A: Via Vercel (Recommended)**
1. Go to your Vercel project → **Storage** tab
2. Click **Create Database** → Select **Neon Postgres**
3. Vercel auto-adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` env vars

**Option B: Direct Setup**
1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy the connection strings
3. Add to Vercel env vars:
   ```
   DATABASE_URL=postgres://...?sslmode=require
   DATABASE_URL_UNPOOLED=postgres://...?sslmode=require
   ```

### 2. GitHub OAuth App

1. Go to GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: `Upstream Agents`
   - **Homepage URL**: `https://your-app.vercel.app`
   - **Authorization callback URL**: `https://your-app.vercel.app/api/auth/callback/github`
3. Click **Register application**
4. Copy the **Client ID**
5. Generate a **Client Secret** and copy it

### 3. Generate Secrets

```bash
# NextAuth secret (32-byte base64)
openssl rand -base64 32

# Encryption key for API credentials (32-byte hex)
openssl rand -hex 32
```

### 4. Environment Variables

Add these to Vercel (Settings → Environment Variables):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon pooled connection | (auto-set by Vercel) |
| `DATABASE_URL_UNPOOLED` | Neon direct connection (migrations) | (auto-set by Vercel) |
| `NEXTAUTH_URL` | Your app's URL | `https://your-app.vercel.app` |
| `NEXTAUTH_SECRET` | Random secret for NextAuth | (output of `openssl rand -base64 32`) |
| `GITHUB_CLIENT_ID` | From GitHub OAuth App | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App | `abc123...` |
| `ENCRYPTION_KEY` | For encrypting API keys | (output of `openssl rand -hex 32`) |
| `DAYTONA_API_KEY` | Your shared Daytona API key | `dtn_...` |
| `DAYTONA_API_URL` | Daytona API endpoint | `https://api.daytona.io` |
| `SMITHERY_API_KEY` | Smithery API key for MCP registry | (from [smithery.ai/account/api-keys](https://smithery.ai/account/api-keys)) |

### 5. Deploy

```bash
# Install dependencies (from monorepo root)
npm install

# Generate Prisma client
npx prisma generate

# Run migrations (uses DATABASE_URL_UNPOOLED)
npx prisma migrate deploy

# Build
npm run build:web
```

Or push to Vercel — the build command handles Prisma generation and migrations automatically.

---

## Development

```bash
# From monorepo root
npm run dev          # Start development server
npm run build:web    # Build for production
npm run start        # Start production server
npm run lint         # ESLint check
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with Prisma generation |
| `npm run build` | Build for production (runs Prisma generate) |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest unit tests |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Run Playwright E2E tests |

---

## Deployment

This package deploys as a Vercel project. See the [monorepo README](../../README.md#deployment) for detailed deployment instructions.

Key points:
- Set **Root Directory** to `packages/web` in Vercel
- Leave Build & Output overrides off (uses `vercel.json`)
- Add all environment variables before the first deploy

---

## License

MIT
