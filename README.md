# Upstream Agents

A monorepo for building applications with AI coding agents (Claude Code, OpenCode, Codex, Gemini, Goose, Pi) running in isolated [Daytona](https://daytona.io) sandboxes.

## Packages

| Package | Description |
|---------|-------------|
| [`@upstream/agents`](packages/agents) | TypeScript SDK for running AI coding agents in Daytona sandboxes |
| [`@upstream/agent-configuration`](packages/agent-configuration) | Agent configuration and policy rules for blocking dangerous operations |
| [`@upstream/claude-credentials`](packages/claude-credentials) | Claude Code OAuth credential generation via ccauth and Daytona |
| [`@upstream/common`](packages/common) | Shared utilities and types |
| [`@upstream/terminal`](packages/terminal) | WebSocket-based PTY terminal for Daytona sandboxes |
| [`@upstream/web`](packages/web) | Standalone chat app for AI coding agents |

---

## Quick Start

```bash
npm install
npm run dev
```

---

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup and [TESTING.md](./TESTING.md) for tests.

## Deployment

See [packages/web/README.md](packages/web/README.md).
