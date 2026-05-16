# Daytona Background Agents

Building blocks for running AI coding agents in isolated [Daytona](https://daytona.io) sandboxes. Can be used in your own projects or as a standalone NextJS app:

https://github.com/user-attachments/assets/ee6de7e9-a32e-45bd-acfa-3da1763b80ea

## Packages

| Package | Description | Maintainer |
|---------|-------------|------------|
| [`agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> <a href="https://github.com/abdulrehmann231"><img src="https://github.com/abdulrehmann231.png?size=64" width="28" height="28"></a> |
| [`agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes | <a href="https://github.com/pluuto19"><img src="https://github.com/pluuto19.png?size=64" width="28" height="28"></a> <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona | <a href="https://github.com/synacktraa"><img src="https://github.com/synacktraa.png?size=64" width="28" height="28"></a> |
| [`common`](packages/common) | Shared utilities and types | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`daytona-git`](packages/daytona-git) | Git operations for Daytona sandboxes | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`daytona-terminal`](packages/daytona-terminal) | WebSocket-based PTY terminal for Daytona sandboxes | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`dev-cron`](packages/dev-cron) | Local development simulator for Vercel cron jobs | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`mcp-providers`](packages/mcp-providers) | MCP provider integrations | <a href="https://github.com/abdulrehmann231"><img src="https://github.com/abdulrehmann231.png?size=64" width="28" height="28"></a> |
| [`skills`](packages/skills) | Agent skills integration for Daytona sandboxes | <a href="https://github.com/pluuto19"><img src="https://github.com/pluuto19.png?size=64" width="28" height="28"></a> |
| [`web`](packages/web) | Standalone chat app for AI coding agents | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |

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
