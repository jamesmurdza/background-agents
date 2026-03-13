# Coding Agents SDK

A TypeScript SDK for interacting with AI coding agents ([Claude](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Gemini](https://geminicli.com/docs/), [OpenCode](https://opencode.ai/docs/)) through a unified interface. **All commands run in secure [Daytona](https://daytona.io) sandboxes by default** with real-time PTY streaming.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })
const claudeSession = await createSession("claude", { sandbox, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })

for await (const event of claudeSession.run("Hello!")) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "end") break
}

await sandbox.delete()
```

Create a sandbox, create a session, stream events, cleanup. Same pattern for Claude, Codex, Gemini, or OpenCode—just swap the provider name and env keys.

## Features

- **Secure by default** - All CLI execution happens in isolated Daytona sandboxes
- **Real-time streaming** - PTY-based streaming for live token output
- **Unified interface** - Same API for Claude, Codex, Gemini, and OpenCode
- **Automatic setup** - The provider CLI is installed when you create a session (pass `skipInstall: true` to skip). Env and Codex login run on every `run()`.
- **Session persistence** - Resume conversations across runs

## Provider Support

| Provider | Status | CLI | Authentication |
|----------|--------|-----|----------------|
| [Claude](https://docs.anthropic.com/en/docs/claude-code) | ✅ | `claude` | `ANTHROPIC_API_KEY` env var |
| [Codex](https://developers.openai.com/codex/cli) | ✅ | `codex` | `OPENAI_API_KEY` env var |
| [OpenCode](https://opencode.ai/docs/) | ✅ | `opencode` | Provider-specific env vars (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) |
| [Gemini](https://geminicli.com/docs/) | 🚧 | `gemini` | `GOOGLE_API_KEY` env var |

## Prerequisites

You'll need a [Daytona](https://daytona.io) API key for sandbox mode. (You can also [run locally](#local-mode-dangerous) without a sandbox.)

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

## Installation

Install the SDK:

```bash
npm install @jamesmurdza/coding-agents-sdk
```

For sandboxed execution, install the Daytona SDK:
```bash
npm install @daytonaio/sdk
```

## Quick Start

### 1. Create a sandbox (Daytona SDK)

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create({
  envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
})
```

### 2. Clone a repo

Use the [Daytona Git SDK](https://www.daytona.io/docs/en/typescript-sdk/git/) to clone a repo at the start.

```typescript
const repoPath = "workspace/repo"
await sandbox.git.clone("https://github.com/user/repo.git", repoPath)
// For private repos: clone(url, path, branch?, commitId?, username?, password?)
```

### 3. Create a session

```typescript
const claudeSession = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet",
  timeout: 120,
})
```

### 4. Stream responses

```typescript
for await (const event of claudeSession.run("Hello!")) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
  if (event.type === "end") break
}
```

### 5. Push when finished

Use the [Daytona Git SDK](https://www.daytona.io/docs/en/typescript-sdk/git/) to push your changes when you're done.

```typescript
await sandbox.git.push(repoPath)
// For private repos: push(path, username?, password?)
```

### 6. Cleanup

```typescript
await sandbox.delete()
```

## Full Example

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  })

  try {
    // Session installs CLI in sandbox and uses env for auth
    const session = await createSession("claude", { sandbox, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })

    // Stream events: tokens and tool calls
    for await (const event of session.run("List /tmp then write /tmp/out.txt with 'done'")) {
      switch (event.type) {
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          switch (event.name) {
            case "shell":
              console.log("\n🛠️ Shell:", event.input?.command ?? "")
              break
            case "write":
              console.log("\n✏️ Write", event.input?.file_path ?? "")
              break
            case "read":
              console.log("\n📖 Read", event.input?.file_path ?? "")
              break
            case "glob":
              console.log("\n🧭 Glob", event.input?.pattern ?? "")
              break
            case "grep":
              console.log("\n🔎 Grep", event.input?.pattern ?? "")
              break
            default:
              console.log("\n🔧 Tool:", event.name)
          }
          break
        case "end":
          console.log("\nDone.")
          break
      }
    }
  } finally {
    await sandbox.delete() // always tear down
  }
}

main()
```

### CLI command per agent

The SDK invokes each provider’s CLI as follows (optional flags in brackets):

| Provider | CLI command |
|----------|-------------|
| **Claude** | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` `[--model <model>] [--resume <sessionId>]` `<prompt>` |
| **Codex** | `codex exec --json --skip-git-repo-check --yolo` `[--model <model>] [resume <sessionId>]` `<prompt>` |
| **OpenCode** | `opencode run --format json --variant medium -m <model>` `[-s <sessionId>]` `<prompt>` (run via `bash -lc "… 2>&1"`) |
| **Gemini** | `gemini -p --output-format stream-json --yolo` `[--model <model>] [--resume <sessionId>]` `<prompt>` |


## API Reference

### createSession(name, options)

Creates a session with defaults (model, timeout, env, etc.) and exposes `session.run(prompt)`. It installs the provider CLI in the sandbox before returning (unless you pass `skipInstall: true`), so the session is ready to use. Pass `env` with your provider API key(s); Codex login runs automatically on each `run()` when needed.

```typescript
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet",
  timeout: 120
})
```

### session.run(prompt)

Streams events from the AI agent using the session defaults.

```typescript
for await (const event of session.run("Hello")) {
  // Handle events
}
```

### Output format (event stream)

`session.run()` yields an async iterable of **events**. Every provider emits the same event shapes so you can handle Claude, Codex, and OpenCode uniformly.

#### Event types

| Event           | Description                    | Fields |
|-----------------|--------------------------------|--------|
| `session`       | Session started (for resumption) | `id: string` |
| `token`         | Streamed text from the assistant | `text: string` |
| `tool_start`    | A tool is being invoked        | `name: string`, `input?: unknown` |
| `tool_delta`    | Streaming tool input (if any)  | `text: string` |
| `tool_end`      | Tool finished                  | `output?: string` |
| `end`           | Turn / message complete        | —      |

#### TypeScript

```typescript
type Event =
  | { type: "session"; id: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_delta"; text: string }
  | { type: "tool_end"; output?: string }
  | { type: "end" }
```

#### Normalized tool names

Tool names are normalized so you can branch on a single set across providers. Each tool has a defined **tool_start input** and **tool_end output** shape.

| Tool     | tool_start `input` (normalized) | tool_end `output` | Claude | Codex | OpenCode |
|----------|---------------------------------|--------------------|:-----:|:-----:|:--------:|
| **write** | `{ file_path: string, content: string \| null, kind: "add" \| "update" }` | Raw string (success message or JSON). | ✅ | ✅ | ✅ |
| **read** | `{ file_path: string }` | File contents string. | ✅ | — | ✅ |
| **edit** | `{ file_path: string, ... }` | Raw string. | ✅ | — | ✅ |
| **glob** | `{ pattern: string }` | Raw string (paths or JSON). | ✅ | — | ✅ |
| **grep** | `{ pattern: string, path?: string }` | Raw string. | ✅ | — | ✅ |
| **shell** | `{ command: string, description?: string }` | Stdout/stderr string. | ✅ | ✅ | ✅ |
| *(other)* | `unknown` (SDK passes through raw provider payload) | Raw string. | ❓ | ❓ | ❓ |

## Model Selection

Each provider supports a `model` option. Set it at session creation.

### Claude Models

```typescript
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })

// Set model at creation (alias or full name)
const claudeSession = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet", // or "opus", "haiku", "claude-sonnet-4-5-20250929"
})
for await (const event of claudeSession.run("Hello")) { /* ... */ }
```

See [Claude Code model configuration](https://code.claude.com/docs/en/model-config) for all available models.

### Codex Models

```typescript
const codexSession = await createSession("codex", {
  sandbox,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
  model: "gpt-4o", // or "o1", "o3"
})
for await (const event of codexSession.run("Hello")) { /* ... */ }
```

See [Codex CLI models](https://developers.openai.com/codex/models) for all available models.

### OpenCode Models

```typescript
// Format: "provider/model" (default is openai/gpt-4o)
const opencodeSession = await createSession("opencode", {
  sandbox,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
  model: "openai/gpt-4o", // or "openai/o1", "anthropic/claude-sonnet", etc.
})
for await (const event of opencodeSession.run("Hello")) { /* ... */ }
```

See [OpenCode models](https://opencode.ai/docs/models/) for all available models and providers.

### Gemini Models

```typescript
const geminiSession = await createSession("gemini", {
  sandbox,
  env: { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY },
  model: "gemini-2.0-flash", // or "gemini-1.5-pro"
})
for await (const event of geminiSession.run("Hello")) { /* ... */ }
```

See [Gemini CLI model selection](https://geminicli.com/docs/cli/model) for all available models.

## Sandboxed Background Sessions

Background sessions let you start agent runs inside a Daytona sandbox that write the JSONL event stream to log files in the sandbox, then **getEvents** for new events. Useful when your app or API may restart while the agent is still running. Events are the same shape as `session.run()`.

**Design (all state except session ID lives in the sandbox):**

- Each background session has a **unique session ID** (e.g. UUID). The host only needs this ID; paths and cursor are derived inside the sandbox.
- **One directory per session** in the sandbox, e.g. `/tmp/codeagent-<id>/`.
- **One log file per turn:** `0.jsonl`, `1.jsonl`, … The CLI appends to the current turn’s file only.
- **One meta file** for the session, e.g. `meta.json`, holding `currentTurn`, `cursor` (line index for the current turn’s log), `pid` (from the latest `start()`), and optional `startedAt`. Cursor is read/updated in the sandbox on each getEvents so the host never passes or stores it.

**Optional cleanup:** When a turn completes (you’ve seen an `end` event), that turn’s log file is no longer written to. The session can then safely delete or truncate that turn’s log file to free space in the sandbox.

**Example:**

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createBackgroundSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
const sandbox = await daytona.create({
  envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
})

const bg = await createBackgroundSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  model: "sonnet",
})
console.log("Background session ID:", bg.id)

const { executionId, pid } = await bg.start("Do a long-running refactor...")
console.log("Started turn", { executionId, pid })

async function poll() {
  const res = await bg.getEvents()
  for (const event of res.events) {
    if (event.type === "token") process.stdout.write(event.text)
    else if (event.type === "tool_start") console.log("[Tool]", event.name)
    else if (event.type === "tool_end") console.log("[Tool end]")
  }
  if (res.status === "completed") {
    console.log("\nTurn completed. Session ID:", res.sessionId)
    return
  }
  setTimeout(poll, 2000)
}
poll()
```

## Local Mode (Dangerous)

If you need to run CLIs directly on your machine (not recommended):

```typescript
const session = await createSession("claude", {
  dangerouslyAllowLocalExecution: true,
})

// Runs claude CLI directly on your machine
let text = ""
for await (const event of session.run("Hello")) {
  if (event.type === "token") text += event.text
}
```

**Warning:** Local mode executes arbitrary CLI commands on your machine. Only use this when you fully trust the code being executed.

## Interactive REPL

Test the SDK interactively with any supported provider:

```bash
# Using Claude (default)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl.ts

# Using Codex
DAYTONA_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/repl.ts --provider codex

# Using OpenCode
DAYTONA_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/repl.ts --provider opencode

# Using Gemini
DAYTONA_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/repl.ts --provider gemini

# Polling-based REPL (uses sandboxed background mode)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl-polling.ts
```

### REPL Options

```bash
npx tsx scripts/repl.ts [options]

Options:
  -p, --provider <name>  Provider to use (default: claude)
  -h, --help             Show help message

Supported providers: claude, codex, opencode, gemini
```

### Example Session

```
============================================================
  Coding Agents SDK - Interactive REPL
  Provider: claude
============================================================

Creating sandbox...
Sandbox created!

Claude provider ready.

Commands:
  Type a prompt and press Enter to send to claude
  /quit or /exit - Exit the REPL
  /clear - Clear session (start fresh)
------------------------------------------------------------

You: Hello!
Thinking...
Claude: Hello! How can I help you today?

You: /quit
Destroying sandbox...
Goodbye!
```

## How It Works

1. **Sandbox**: You create a Daytona sandbox with `@daytonaio/sdk` and pass it directly to createSession
2. **CLI installation**: The provider CLI is installed when you create the session (unless `skipInstall: true`). On every `run()`, env is set and for Codex `codex login --with-api-key` runs
3. **PTY Streaming**: Commands run via PTY for real-time output streaming
4. **Event Parsing**: JSON output is parsed into typed events
5. **Cleanup**: You destroy the sandbox when done (e.g. `await sandbox.delete()`)

```
┌─────────────┐     ┌──────────────────────────────────────┐
│             │     │          Daytona Sandbox             │
│   Your App  │────▶│  ┌─────────────┐    ┌─────────────┐  │
│             │◀────│  │  PTY Stream │◀──▶│  Agent CLI  │  │
│             │     │  └─────────────┘    │   (Agent)   │  │
└─────────────┘     │                     └─────────────┘  │
                    └──────────────────────────────────────┘
```

The AI agent (Claude CLI, Codex, etc.) runs entirely inside the isolated Daytona sandbox, ensuring secure execution of all agent operations.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run unit tests (95 tests)
npm test

# Run integration test
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/test-sdk-full.ts

# Run REPL
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl.ts
```

## Resources

### Sandbox Infrastructure
- [Daytona Documentation](https://www.daytona.io/docs/) - Secure sandbox infrastructure
- [Daytona GitHub](https://github.com/daytonaio/daytona) - Open source sandbox platform

### AI Coding Agents
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's agentic coding tool ([GitHub](https://github.com/anthropics/claude-code))
- [Codex CLI](https://developers.openai.com/codex/cli) - OpenAI's lightweight coding agent ([GitHub](https://github.com/openai/codex))
- [Gemini CLI](https://geminicli.com/docs/) - Google's open-source AI agent ([GitHub](https://github.com/google-gemini/gemini-cli))
- [OpenCode](https://opencode.ai/docs/) - Open source AI coding agent ([GitHub](https://github.com/opencode-ai/opencode))

## License

MIT
