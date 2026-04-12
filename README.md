# Upstream Agents

A monorepo for building applications with AI coding agents (Claude Code, OpenCode, Codex, Gemini, Goose, Pi) running in isolated [Daytona](https://daytona.io) sandboxes.

## Packages

| Package | Description | Links |
|---------|-------------|-------|
| [`@upstream/agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes | [README](packages/agents/README.md) |
| [`@upstream/common`](packages/common) | Shared utilities and types | [README](packages/common/README.md) |
| [`@upstream/terminal`](packages/terminal) | WebSocket-based PTY terminal for Daytona sandboxes | [README](packages/terminal/README.md) |
| [`@upstream/web`](packages/web) | Multi-tenant web app with Slack-like interface | [README](packages/web/README.md) |
| [`@upstream/simple-chat`](packages/simple-chat) | Standalone chat app for AI coding agents | [README](packages/simple-chat/README.md) |

---

## Quick Start

```bash
# Install dependencies
npm install

# Build SDK packages
npm run build:sdk

# Start the web app
npm run dev

# Or start simple-chat
npm run dev:simple-chat
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Applications                                    │
│  ┌──────────────────────┐     ┌──────────────────────────────────────┐ │
│  │  @upstream/web       │     │  @upstream/simple-chat               │ │
│  │  - Full-featured app │     │  - Lightweight chat                  │ │
│  │  - Multi-tenant      │     │  - Single-tenant                     │ │
│  │  - Database-backed   │     │  - Local storage                     │ │
│  └──────────────────────┘     └──────────────────────────────────────┘ │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │
┌─────────────────────────────────────┼──────────────────────────────────┐
│                         Shared Packages                                 │
│  ┌──────────────────────┐  ┌───────┴───────┐  ┌──────────────────────┐ │
│  │  @upstream/agents    │  │ @upstream/    │  │  @upstream/terminal  │ │
│  │  - Agent SDK         │  │ common        │  │  - PTY terminal      │ │
│  │  - Claude, Codex...  │  │ - Utilities   │  │  - WebSocket         │ │
│  │  - Session mgmt      │  │ - Types       │  │  - xterm.js          │ │
│  └──────────────────────┘  └───────────────┘  └──────────────────────┘ │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │   Daytona Sandboxes  │
                           │   - Isolated envs    │
                           │   - Git repos        │
                           │   - AI agents        │
                           └──────────────────────┘
```

---

## Development

This is an npm-workspaces monorepo:

```
packages/
├── agents/        # @upstream/agents      — TypeScript SDK for AI coding agents
├── common/        # @upstream/common      — Shared utilities and types
├── terminal/      # @upstream/terminal    — WebSocket-based PTY terminal
├── web/           # @upstream/web         — Main Next.js application
└── simple-chat/   # @upstream/simple-chat — Standalone chat Next.js application
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the `web` development server |
| `npm run dev:simple-chat` | Start the `simple-chat` development server (port 4000) |
| `npm run build` | Build SDK + both apps (CI / local sanity check) |
| `npm run build:sdk` | Build only the SDK package |
| `npm run build:web` | Build SDK + `web` app |
| `npm run build:simple-chat` | Build SDK + `simple-chat` app |
| `npm run start` | Start `web` production server |
| `npm run start:simple-chat` | Start `simple-chat` production server |
| `npm run lint` | ESLint check across all packages |
| `npm run clean` | Clean build artifacts |

For full local development setup (database, environment variables, running the dev server), see [DEVELOPMENT.md](./DEVELOPMENT.md).

### Testing

For unit tests and Playwright end-to-end tests, see [TESTING.md](./TESTING.md).

---

## Deployment

`packages/web` and `packages/simple-chat` deploy as **two independent Vercel projects** from the same repo. Each has its own `vercel.json` pinning `buildCommand`, `outputDirectory`, and an `ignoreCommand` that delegates to [scripts/vercel-ignore.sh](scripts/vercel-ignore.sh); there is no root `vercel.json`.

### Setup Steps

1. **Create Vercel Project**: Add New → Project → Import Git Repository
2. **Set Root Directory**: `packages/web` or `packages/simple-chat`
3. **Configure Build**: Leave Build & Output overrides off (uses `vercel.json`)
4. **Add Environment Variables**: Before the first deploy

### Environment Variables

**@upstream/web** needs the full set:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon pooled connection |
| `DATABASE_URL_UNPOOLED` | Neon direct connection (migrations) |
| `NEXTAUTH_URL` | Your app's URL |
| `NEXTAUTH_SECRET` | Random secret for NextAuth |
| `GITHUB_CLIENT_ID` | From GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App |
| `ENCRYPTION_KEY` | For encrypting API keys |
| `DAYTONA_API_KEY` | Your shared Daytona API key |
| `DAYTONA_API_URL` | Daytona API endpoint |
| `SMITHERY_API_KEY` | Smithery API key for MCP registry |

**@upstream/simple-chat** only needs:
- `DAYTONA_API_KEY`, `DAYTONA_API_URL`
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- Optionally: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

### Selective Deploys

`vercel-ignore.sh` skips a deploy when nothing under the app's package, its workspace dependencies (`agents`, `common`), or root config changed since the previous deploy. The first deploy of a project always runs.

For detailed package-specific setup, see:
- [packages/web/README.md](packages/web/README.md)
- [packages/simple-chat/README.md](packages/simple-chat/README.md)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run linting: `npm run lint`
5. Commit your changes: `git commit -m "Add my feature"`
6. Push to the branch: `git push origin feature/my-feature`
7. Open a Pull Request

---

## License

MIT
