# Daytona Background Agents

Building blocks for running AI coding agents in isolated [Daytona](https://daytona.io) sandboxes. Can be used in your own projects or as a standalone NextJS app:

https://github.com/user-attachments/assets/ee6de7e9-a32e-45bd-acfa-3da1763b80ea

## Packages

### Published packages

On npm — use them in your own projects.

| Package | Description | Maintainer |
|---------|-------------|------------|
| [`agent-configuration`](packages/agent-configuration) | Translation layer between coding agents' configuration formats | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> <a href="https://github.com/abdulrehmann231"><img src="https://github.com/abdulrehmann231.png?size=64" width="28" height="28"></a> |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona | <a href="https://github.com/synacktraa"><img src="https://github.com/synacktraa.png?size=64" width="28" height="28"></a> |
| [`launcher`](packages/launcher) | `npx background-agents` launcher that runs the desktop app | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`mcp`](packages/mcp) | MCP provider integrations | <a href="https://github.com/abdulrehmann231"><img src="https://github.com/abdulrehmann231.png?size=64" width="28" height="28"></a> |
| [`sandbox-git`](packages/sandbox-git) | Git operations for Daytona sandboxes | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`sandbox-jobs`](packages/sandbox-jobs) | Run, observe, and reconnect to long-running shell processes in a Daytona sandbox via the filesystem | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`sandbox-skills`](packages/sandbox-skills) | Agent skills integration for Daytona sandboxes | <a href="https://github.com/pluuto19"><img src="https://github.com/pluuto19.png?size=64" width="28" height="28"></a> |
| [`sandbox-terminal`](packages/sandbox-terminal) | WebSocket-based PTY terminal for Daytona sandboxes | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`sdk`](packages/sdk) | TypeScript SDK for running AI coding agents in Daytona sandboxes | <a href="https://github.com/pluuto19"><img src="https://github.com/pluuto19.png?size=64" width="28" height="28"></a> <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |

### Internal packages

Not published — apps and shared internals used only in this repo.

| Package | Description | Maintainer |
|---------|-------------|------------|
| [`common`](packages/common) | Shared utilities and types | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`desktop`](packages/desktop) | Electron desktop app for Background Agents | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`dev-cron`](packages/dev-cron) | Local development simulator for Vercel cron jobs | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`sandbox-image`](packages/sandbox-image) | Custom Daytona sandbox image with pre-installed agent CLIs | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |
| [`web`](packages/web) | Standalone chat app for AI coding agents | <a href="https://github.com/jamesmurdza"><img src="https://github.com/jamesmurdza.png?size=64" width="28" height="28"></a> |

---

## Prerequisites

- Node.js 20.9+ (required by Next.js 16)

## Quick start (Web)

Set up a local Postgres database and a `.env.local` file with the variables listed under [Development](packages/web/README.md#development).

```bash
npm install
npm run prisma:migrate
npm run dev
```

Open http://localhost:4000.

## Quick start (Desktop)

The desktop app loads the web app, so it has the same prerequisites as the Web quick start above.

```bash
npm install
npm run dev:electron
```

This starts the local web server and launches the Electron app.

## Deployment

The `web` package deploys to Vercel. See [Deployment](packages/web/README.md#deployment) for env vars and configuration.
