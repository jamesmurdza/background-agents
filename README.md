# Daytona Background Agents

Building blocks for running AI coding agents in isolated [Daytona](https://daytona.io) sandboxes. Can be used in your own projects or as a standalone NextJS app:

https://github.com/user-attachments/assets/ee6de7e9-a32e-45bd-acfa-3da1763b80ea

## Packages

| Package | Description | Maintainer |
|---------|-------------|------------|
| [`agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) [![](https://github.com/abdulrehmann231.png?size=20)](https://github.com/abdulrehmann231) |
| [`agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes | [![](https://github.com/pluuto19.png?size=20)](https://github.com/pluuto19) [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona | [![](https://github.com/synacktraa.png?size=20)](https://github.com/synacktraa) |
| [`common`](packages/common) | Shared utilities and types | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |
| [`daytona-git`](packages/daytona-git) | Git operations for Daytona sandboxes | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |
| [`daytona-terminal`](packages/daytona-terminal) | WebSocket-based PTY terminal for Daytona sandboxes | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |
| [`dev-cron`](packages/dev-cron) | Local development simulator for Vercel cron jobs | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |
| [`mcp-providers`](packages/mcp-providers) | MCP provider integrations | [![](https://github.com/abdulrehmann231.png?size=20)](https://github.com/abdulrehmann231) |
| [`web`](packages/web) | Standalone chat app for AI coding agents | [![](https://github.com/jamesmurdza.png?size=20)](https://github.com/jamesmurdza) |

---

## Prerequisites

- Node.js 18+

## Quick start

```bash
npm install
npm run build:sdk
npm run dev
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup (database, environment variables) and [TESTING.md](./TESTING.md) for tests.

## Deployment

The `web` package deploys to Vercel. See [packages/web/README.md](packages/web/README.md) for configuration.
