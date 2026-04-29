# @upstream/agent-configuration

Agent configuration and policy rules for blocking dangerous operations in AI coding agents.

## Overview

This package provides centralized configuration for AI coding agents running in sandboxed environments. The primary focus is **git safety** - preventing agents from executing dangerous git operations that could:

- Rewrite history (`git commit --amend`, `git rebase`, `git reset --hard`)
- Push changes without authorization (`git push`)
- Manipulate branches (`git branch -d/-D/-m/-M`, `git checkout -b`, `git switch -c`)
- Switch branches (`git checkout <branch>`, `git switch <branch>`)

## Installation

```bash
npm install @upstream/agent-configuration
```

## Usage

### Claude Code

Claude Code uses bash hooks that intercept commands before execution:

```ts
import { setupClaudeHooks } from '@upstream/agent-configuration'

// During agent session setup
await setupClaudeHooks(sandbox)
```

### Codex

Codex uses Starlark rules stored in `~/.codex/rules/`:

```ts
import { setupCodexRules } from '@upstream/agent-configuration'

// During agent session setup
await setupCodexRules(sandbox)
```

### OpenCode

OpenCode uses a JSON permission system via environment variable:

```ts
import { OPENCODE_PERMISSION_ENV } from '@upstream/agent-configuration'

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

## Exports

### Git Safety

```ts
import {
  // Common
  BLOCKED_GIT_OPERATIONS,
  ALL_BLOCKED_COMMANDS,

  // Claude Code
  setupClaudeHooks,
  CLAUDE_HOOK_CONTENT,

  // Codex
  setupCodexRules,
  CODEX_RULES_CONTENT,

  // OpenCode
  OPENCODE_PERMISSION_ENV,
  OPENCODE_PERMISSIONS,
} from '@upstream/agent-configuration'
```

## License

MIT
