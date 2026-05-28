# @background-agents/agent-configuration

Agent configuration and policy rules for AI coding agents running in Daytona sandboxes.

## Overview

This package provides centralized configuration for AI coding agents running in sandboxed environments. It covers two areas:

1. **Git safety** — Preventing agents from executing dangerous git operations that could:
   - Rewrite history (`git commit --amend`, `git rebase`, `git reset --hard`)
   - Push changes without authorization (`git push`)
   - Manipulate branches (`git branch -d/-D/-m/-M`, `git checkout -b`, `git switch -c`)
   - Switch branches (`git checkout <branch>`, `git switch <branch>`)
2. **MCP setup** — Writing per-agent MCP server configuration files into the sandbox so the agent CLI picks them up on startup.

## Installation

```bash
npm install @background-agents/agent-configuration
```

## Usage

### Claude Code

Claude Code uses bash hooks that intercept commands before execution:

```ts
import { setupClaudeHooks } from '@background-agents/agent-configuration'

// During agent session setup
await setupClaudeHooks(sandbox)
```

### Codex

Codex uses Starlark rules stored in `~/.codex/rules/`:

```ts
import { setupCodexRules } from '@background-agents/agent-configuration'

// During agent session setup
await setupCodexRules(sandbox)
```

### OpenCode

OpenCode uses a JSON permission system via environment variable:

```ts
import { OPENCODE_PERMISSION_ENV } from '@background-agents/agent-configuration'

// When starting the agent
const env = {
  OPENCODE_PERMISSION: OPENCODE_PERMISSION_ENV,
}
```

## Blocked Operations

All agents block the same set of dangerous operations:

| Category | Commands | Reason |
|----------|----------|--------|
| History Rewriting | `git commit --amend` | Modifies the last commit |
| | `git rebase` | Rewrites commit history |
| | `git reset --hard` | Discards commits |
| Push | `git push` | Handled automatically by platform |
| Branch Deletion | `git branch -d/-D` | Prevents accidental deletion |
| Branch Renaming | `git branch -m/-M` | Prevents branch manipulation |
| Branch Creation | `git checkout -b`, `git switch -c` | Agents should stay on assigned branch |
| Branch Switching | `git checkout <branch>`, `git switch <branch>` | Agents should stay on assigned branch |

## MCP Setup

Writes per-agent MCP server configs into the sandbox before the agent CLI starts. Currently supported agents: `claude-code`, `codex`, `gemini`, `opencode`, `goose`, `copilot`, `kilo`.

```ts
import { setupMcpForAgent } from '@background-agents/agent-configuration'

await setupMcpForAgent(sandbox, {
  agent: 'claude-code',
  servers: [
    {
      name: 'github',
      url: 'https://api.githubcopilot.com/mcp/',
      bearerToken: '<github-installation-token>',
    },
  ],
})
```

The function is a no-op for agents that don't support MCP. Each agent CLI loads MCP servers from a different config file with a different schema; this helper writes the correct file in the correct format.

## Exports

### Git Safety

```ts
import {
  // Claude Code
  setupClaudeHooks,
  CLAUDE_HOOKS_DIR,
  CLAUDE_HOOK_FILE,
  CLAUDE_HOOK_CONTENT,
  CLAUDE_SETTINGS_FILE,
  CLAUDE_SETTINGS,

  // Codex
  setupCodexRules,
  CODEX_RULES_DIR,
  CODEX_RULES_FILE,
  CODEX_RULES_CONTENT,

  // OpenCode
  OPENCODE_PERMISSION_ENV,
  OPENCODE_PERMISSION_CONFIG,
  OPENCODE_PERMISSIONS,
} from '@background-agents/agent-configuration'
```

### MCP

```ts
import {
  setupMcpForAgent,
  type AgentMcpServer,
  type SetupMcpOptions,
} from '@background-agents/agent-configuration'
```

## License

MIT
