# Daytona Background Agents

Building blocks for running AI coding agents in isolated [Daytona](https://daytona.io) sandboxes. Use them in your own projects or run the standalone Next.js app.

https://github.com/user-attachments/assets/ee6de7e9-a32e-45bd-acfa-3da1763b80ea

## Packages

**Published** (on npm, for use in your own projects):

| Package | Description |
|---------|-------------|
| [`agent-configuration`](packages/agent-configuration) | Translation layer between coding agents' configuration formats |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona |
| [`launcher`](packages/launcher) | `npx background-agents` launcher for the desktop app |
| [`mcp`](packages/mcp) | MCP provider integrations |
| [`sandbox-git`](packages/sandbox-git) | Git operations for Daytona sandboxes |
| [`sandbox-jobs`](packages/sandbox-jobs) | Run and reconnect to long-running shell processes via the filesystem |
| [`sandbox-skills`](packages/sandbox-skills) | Agent skills integration for Daytona sandboxes |
| [`sandbox-terminal`](packages/sandbox-terminal) | WebSocket-based PTY terminal for Daytona sandboxes |
| [`sdk`](packages/sdk) | TypeScript SDK for running AI coding agents in Daytona sandboxes |

**Internal** (used only in this repo):

| Package | Description |
|---------|-------------|
| [`common`](packages/common) | Shared utilities and types |
| [`desktop`](packages/desktop) | Electron desktop app |
| [`dev-cron`](packages/dev-cron) | Local simulator for Vercel cron jobs |
| [`sandbox-image`](packages/sandbox-image) | Custom sandbox image with pre-installed agent CLIs |
| [`web`](packages/web) | Standalone chat app for AI coding agents |

## Quick start

Requires Node.js 20.9+.

**Web** — set up a local Postgres database and a `.env.local` file (see [Development](packages/web/README.md#development)):

```bash
npm install
npm run prisma:migrate
npm run dev
```

Open http://localhost:4000.

**Desktop** — loads the web app, so it shares the same prerequisites:

```bash
npm install
npm run dev:electron
```

## Deployment

The `web` package deploys to Vercel. See [Deployment](packages/web/README.md#deployment) for configuration.
