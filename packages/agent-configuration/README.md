# @background-agents/agent-configuration

A translation layer between coding agents' configuration formats.

## Overview

Every coding agent (Claude Code, Codex, Gemini, OpenCode, Goose, Copilot, Kilo,
Kimi) loads MCP servers and command-permission rules from a different file, in a
different schema, with a different transport convention. This package takes
**agent-agnostic inputs** and renders the correct **native config** for whichever
agent is running, then installs it into the sandbox.

There are two translation domains:

1. **MCP servers** — given a list of `{ name, url, bearerToken }` connections,
   write the right config file in the right format for the target agent.
2. **Command permissions** — given a `CommandPolicy` (a list of command rules to
   deny), render it into the agent's native mechanism: a Claude `PreToolUse` bash
   hook, Codex Starlark `prefix_rule`s, or the OpenCode `OPENCODE_PERMISSION` JSON.

You supply the inputs; the package handles the per-agent formats. The command
ruleset itself (e.g. "block `git push`/`rebase`/...") stays in your app — in this
repo it lives in `packages/web/lib/git-policy.ts` as `DEFAULT_GIT_POLICY` — so the
same policy renders identically across every agent and lives in one place to
edit.

## Installation

```bash
npm install @background-agents/agent-configuration
```

## Command permissions

Describe what to deny with the agent-agnostic `CommandPolicy` vocabulary, then
hand it to the renderer for whichever agent is running:

```ts
import {
  setupClaudePermissions,
  setupCodexPermissions,
  renderOpenCodePermissionEnv,
  type CommandPolicy,
} from "@background-agents/agent-configuration/permissions"

const policy: CommandPolicy = {
  deny: [
    { kind: "deny", prefix: ["git", "push"], reason: "Pushing is automatic." },
    {
      kind: "deny-except",
      prefix: ["git", "rebase"],
      allow: ["--continue", "--abort", "--skip"],
      reason: "rebase rewrites history.",
    },
    // ...
  ],
}

await setupClaudePermissions(sandbox, policy) // Claude Code bash hook
await setupCodexPermissions(sandbox, policy)  // Codex Starlark rules
env.OPENCODE_PERMISSION = renderOpenCodePermissionEnv(policy) // OpenCode env
```

### Rule kinds

| `kind`            | Matches                                                       | Example                                           |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `deny`            | the prefix, always                                           | `["git", "push"]`                                 |
| `deny-with-flag`  | the prefix when any `flags` token appears in the args        | `["git", "branch"]` + `["-d", "-D"]`              |
| `deny-except`     | the prefix unless the next token is in `allow`               | `["git", "rebase"]` + `["--continue", "--abort"]` |
| `deny-branch-arg` | the prefix + a branch ref (`allowFileForms` permits `.`/`--`/`HEAD`) | `["git", "checkout"]`                      |

Each renderer expresses these as faithfully as its format allows. Where a format
can't model a nuance — OpenCode globs can't say "deny unless `--continue`", and
Codex `prefix_rule`s can't match a flag mid-argument — the renderer falls back
to denying the whole prefix (so e.g. `git checkout`/`switch` are blocked
entirely for Codex/OpenCode, and agents are told to use `git restore`).

Renderers are also exposed as pure functions (`renderClaudeHook`,
`renderCodexRules`, `renderOpenCodePermissions`) for testing or custom install
flows. OpenCode additionally merges in `OPENCODE_BASELINE_PERMISSIONS` — the
baseline allows (`edit`, `webfetch`, `external_directory`) the agent needs to
run headlessly.

## MCP setup

Writes per-agent MCP server configs into the sandbox before the agent CLI
starts. Supported agents: `claude-code`, `codex`, `gemini`, `opencode`, `goose`,
`copilot`, `kilo`, `kimi`. It's a no-op for agents that don't support MCP.

```ts
import { setupMcpForAgent } from "@background-agents/agent-configuration/mcp"

await setupMcpForAgent(sandbox, {
  agent: "claude-code",
  servers: [
    {
      name: "github",
      url: "https://api.githubcopilot.com/mcp/",
      bearerToken: "<github-installation-token>",
    },
  ],
})
```

Each agent CLI loads MCP servers from a different config file with a different
schema; this helper writes the correct file in the correct format. Passing an
empty `servers` list still writes the config, clearing any stale entries from a
previous run in a reused sandbox.

## Exports

```ts
// "@background-agents/agent-configuration/permissions"
import {
  type CommandPolicy,
  type CommandRule,
  // Claude
  setupClaudePermissions,
  renderClaudeHook,
  CLAUDE_HOOKS_DIR,
  CLAUDE_HOOK_FILE,
  CLAUDE_SETTINGS_FILE,
  CLAUDE_SETTINGS,
  // Codex
  setupCodexPermissions,
  renderCodexRules,
  CODEX_RULES_DIR,
  CODEX_RULES_FILE,
  // OpenCode
  renderOpenCodePermissions,
  renderOpenCodePermissionEnv,
  OPENCODE_BASELINE_PERMISSIONS,
} from "@background-agents/agent-configuration/permissions"

// "@background-agents/agent-configuration/mcp"
import {
  setupMcpForAgent,
  type AgentMcpServer,
  type SetupMcpOptions,
} from "@background-agents/agent-configuration/mcp"
```

The package root (`.`) re-exports both submodules.

## License

MIT
