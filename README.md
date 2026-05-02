# Daytona Background Agents

Building blocks for running AI coding agents in isolated [Daytona](https://daytona.io) sandboxes. Can be used in your own projects or as a standalone NextJS app:

https://github.com/user-attachments/assets/ee6de7e9-a32e-45bd-acfa-3da1763b80ea

## Packages

| Package | Description |
|---------|-------------|
| [`web`](packages/web) | Standalone chat app for AI coding agents |
| [`agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes |
| [`agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona |
| [`common`](packages/common) | Shared utilities and types |
| [`daytona-git`](packages/daytona-git) | Git operations for Daytona sandboxes |
| [`terminal`](packages/terminal) | WebSocket-based PTY terminal for Daytona sandboxes |

---

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup (database, environment variables) and [TESTING.md](./TESTING.md) for tests.

## Deployment

The `web` package deploys to Vercel. See [packages/web/README.md](packages/web/README.md) for configuration.
