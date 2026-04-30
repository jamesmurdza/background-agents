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
npm install
npm run dev
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Application                                   │
│                     ┌──────────────────────┐                            │
│                     │  @upstream/web       │                            │
│                     │  - Chat application  │                            │
│                     │  - Database-backed   │                            │
│                     └──────────────────────┘                            │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────────────┐
│                        Shared Packages                                   │
│  ┌────────────────┐ ┌────────────┴────────────┐ ┌─────────────────────┐ │
│  │ @upstream/     │ │ @upstream/agents        │ │ @upstream/terminal  │ │
│  │ common         │ │ - Agent SDK             │ │ - PTY terminal      │ │
│  │ - Utilities    │ │ - Claude, Codex, etc.   │ │ - WebSocket         │ │
│  │ - Types        │ │ - Session management    │ │ - xterm.js          │ │
│  └────────────────┘ └─────────────────────────┘ └─────────────────────┘ │
│  ┌────────────────┐ ┌─────────────────────────┐                         │
│  │ @upstream/     │ │ @upstream/              │                         │
│  │ agent-config   │ │ claude-credentials      │                         │
│  │ - Safety rules │ │ - OAuth credentials     │                         │
│  └────────────────┘ └─────────────────────────┘                         │
└──────────────────────────────────┬──────────────────────────────────────┘
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
| `npm run dev` | Start the development server |
| `npm run build` | Build SDK + web app |
| `npm run build:sdk` | Build only the SDK packages |
| `npm run build:web` | Build SDK + web app |
| `npm run start` | Start production server |
| `npm run lint` | ESLint check across all packages |
| `npm run clean` | Clean build artifacts |
| `npm run prisma:migrate` | Create + apply migrations |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:status` | Check migration status |

For full local development setup (database, environment variables, running the dev server), see [DEVELOPMENT.md](./DEVELOPMENT.md).

### Testing

For unit tests and Playwright end-to-end tests, see [TESTING.md](./TESTING.md).

---

## Deployment

`packages/web` deploys as a Vercel project. It has its own `vercel.json` pinning `buildCommand` and `outputDirectory`; there is no root `vercel.json`.

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
