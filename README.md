# Upstream Agents

A monorepo for building applications with AI coding agents (Claude Code, OpenCode, Codex, Gemini, Goose, Pi) running in isolated [Daytona](https://daytona.io) sandboxes.

## Packages

| Package | Description |
|---------|-------------|
| [`web`](packages/web) | Standalone chat app for AI coding agents |
| [`agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes |
| [`agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations |
| [`claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona |
| [`common`](packages/common) | Shared utilities and types |
| [`terminal`](packages/terminal) | WebSocket-based PTY terminal for Daytona sandboxes |

---

## Quick Start

```bash
npm install
npm run dev
```

Opens the web app at [http://localhost:4000](http://localhost:4000).

---

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup (database, environment variables) and [TESTING.md](./TESTING.md) for tests.

## Deployment

Deploys to Vercel. See [packages/web/README.md](packages/web/README.md) for configuration.
