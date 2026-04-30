# Upstream Agents

A monorepo for building applications with AI coding agents (Claude Code, OpenCode, Codex, Gemini, Goose, Pi) running in isolated [Daytona](https://daytona.io) sandboxes.

## Packages

| Package | Description | Links |
|---------|-------------|-------|
| [`@upstream/agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes | [README](packages/agents/README.md) |
| [`@upstream/agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations | — |
| [`@upstream/claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona | — |
| [`@upstream/common`](packages/common) | Shared utilities and types | [README](packages/common/README.md) |
| [`@upstream/terminal`](packages/terminal) | WebSocket-based PTY terminal for Daytona sandboxes | [README](packages/terminal/README.md) |
| [`@upstream/web`](packages/web) | Standalone chat app for AI coding agents | [README](packages/web/README.md) |

---

## Quick Start

```bash
# Install dependencies
npm install

# Build SDK packages
npm run build:sdk

# Start the web app
npm run dev
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                           Application                                   │
│                    ┌──────────────────────┐                            │
│                    │  @upstream/web       │                            │
│                    │  - Chat application  │                            │
│                    │  - Database-backed   │                            │
│                    └──────────────────────┘                            │
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
├── agents/              # background-agents             — TypeScript SDK for AI coding agents
├── agent-configuration/ # @upstream/agent-configuration — Agent safety policies
├── claude-credentials/  # @upstream/claude-credentials  — Claude Code OAuth credentials
├── common/              # @upstream/common              — Shared utilities and types
├── terminal/            # @upstream/terminal            — WebSocket-based PTY terminal
└── web/                 # @upstream/web                 — Main Next.js chat application
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the `web` development server (port 4000) |
| `npm run build` | Build SDK + web app |
| `npm run build:sdk` | Build only the SDK package |
| `npm run build:web` | Build SDK + `web` app |
| `npm run start` | Start `web` production server |
| `npm run lint` | ESLint check across all packages |
| `npm run clean` | Clean build artifacts |
| `npm run prisma:migrate` | Create + apply migrations for `web` |
| `npm run prisma:status` | Check migration status for `web` |

For full local development setup (database, environment variables, running the dev server), see [DEVELOPMENT.md](./DEVELOPMENT.md).

### Testing

For unit tests and Playwright end-to-end tests, see [TESTING.md](./TESTING.md).

---

## Deployment

`packages/web` deploys as a Vercel project. It has its own `vercel.json` pinning `buildCommand`, `outputDirectory`, and an `ignoreCommand` that delegates to [scripts/vercel-ignore.sh](scripts/vercel-ignore.sh); there is no root `vercel.json`.

### Setup Steps

1. **Create Vercel Project**: Add New → Project → Import Git Repository
2. **Set Root Directory**: `packages/web`
3. **Configure Build**: Leave Build & Output overrides off (uses `vercel.json`)
4. **Add Environment Variables**: Before the first deploy

### Environment Variables

**@upstream/web** needs:
- `DATABASE_URL` - PostgreSQL connection string
- `ENCRYPTION_KEY` - For encrypting API keys
- `DAYTONA_API_KEY`, `DAYTONA_API_URL`
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

### Selective Deploys

`vercel-ignore.sh` skips a deploy when nothing under the app's package, its workspace dependencies (`agents`, `common`), or root config changed since the previous deploy. The first deploy of a project always runs.

For detailed package-specific setup, see:
- [packages/web/README.md](packages/web/README.md)

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
