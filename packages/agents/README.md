# Background Agents SDK

A TypeScript SDK for running AI coding agents (Claude, Codex, Gemini, Goose, OpenCode, Pi) in secure [Daytona](https://daytona.io) sandboxes. Designed for background execution with polling-based event streaming.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@upstream/agents"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
})

await session.start("Refactor the auth module")

// Poll for events
while (await session.isRunning()) {
  const { events } = await session.getEvents()
  for (const event of events) {
    if (event.type === "token") process.stdout.write(event.text)
  }
  await new Promise(r => setTimeout(r, 1000))
}

await sandbox.delete()
```

---

## Features

- **Secure sandboxed execution** — Agents run in isolated Daytona sandboxes
- **Background execution** — Start agents, poll for events, survive restarts
- **Unified API** — One interface for [Claude](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Gemini](https://geminicli.com/docs/), [Goose](https://block.github.io/goose/docs/), [OpenCode](https://opencode.ai/docs/), and [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- **Zero-friction setup** — Provider CLI auto-installed in sandbox
- **Session persistence** — Resume conversations across runs and restarts

---

## Provider support

| Provider | Status | Auth |
|----------|--------|------|
| [Claude](https://docs.anthropic.com/en/docs/claude-code) | ✅ | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_CREDENTIALS` |
| [Codex](https://developers.openai.com/codex/cli) | ✅ | `OPENAI_API_KEY` |
| [Goose](https://block.github.io/goose/docs/) | ✅ | Provider-specific (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) |
| [OpenCode](https://opencode.ai/docs/) | ✅ | Provider-specific (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) |
| [Gemini](https://geminicli.com/docs/) | ✅ | `GEMINI_API_KEY` |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | ✅ | Provider-specific (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |

### CLI reference commands

| Provider | CLI Command |
|----------|-------------|
| Claude | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions "prompt"` |
| Codex | `codex exec --json --skip-git-repo-check --yolo "prompt"` |
| Goose | `goose run --output-format stream-json --text "prompt"` |
| OpenCode | `opencode run --format json --variant medium "prompt"` |
| Gemini | `gemini --output-format stream-json --yolo -p "prompt"` |
| Pi | `pi --mode json -p "prompt"` |

---

## Prerequisites

A [Daytona](https://daytona.io) API key for secure sandboxed execution.

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

---

## Installation

```bash
npm install @upstream/agents @daytonaio/sdk
```

---

## Quick start

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@upstream/agents"

// 1. Create sandbox
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// 2. Create session
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet",
  systemPrompt: "You are a helpful coding assistant.",
})

// 3. Start a task
await session.start("Create a hello world script")

// 4. Poll for events
while (await session.isRunning()) {
  const { events } = await session.getEvents()
  for (const event of events) {
    if (event.type === "token") process.stdout.write(event.text)
    if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
    if (event.type === "end") console.log("\nDone.")
  }
  await new Promise(r => setTimeout(r, 1000))
}

// 5. Cleanup
await sandbox.delete()
```

---

## Restart-tolerant workflows

The SDK is designed for long-running tasks that may outlive your server process. Persist `sandbox.id` and `session.id`, then reattach after restart.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession, getSession } from "@upstream/agents"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
const sandbox = await daytona.create()

// Start a task
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  model: "sonnet",
})
await session.start("Do a long-running refactor...")

// Persist these IDs, then exit
const sandboxId = sandbox.id
const sessionId = session.id  // Save this to reattach later

// --- After restart ---

// Reattach to existing session
const sandbox = await daytona.get(sandboxId)
const session = await getSession(sessionId, { sandbox })

// Continue polling
const { events, running } = await session.getEvents()
for (const event of events) {
  if (event.type === "token") process.stdout.write(event.text)
}

// Cancel if needed
await session.cancel()
```

---

## API reference

### `createSession(provider, options)`

Creates a session. The provider CLI is installed automatically.

```typescript
const session = await createSession("claude", {
  sandbox,                                    // Daytona sandbox
  env: { ANTHROPIC_API_KEY: "sk-..." },      // Environment variables
  model: "sonnet",                            // Optional: model name
  systemPrompt: "You are helpful.",           // Optional: system prompt
})
```

### `session.start(prompt)`

Starts a background task. Returns immediately with process info.

```typescript
const { pid, outputFile } = await session.start("Your task here")
```

### `session.getEvents()`

Polls for new events since last call.

```typescript
const { events, running } = await session.getEvents()
// events: Event[] - new events since last poll
// running: boolean - true if agent is still running
```

### `session.isRunning()`

Returns `true` while the agent is running.

### `session.cancel()`

Kills the running agent process.

### `getSession(sessionId, options)`

Reattaches to an existing session by ID.

```typescript
const session = await getSession(
  sessionId,   // session.id from createSession()
  { sandbox }
)
```

---

## Event types

| Event | Description | Fields |
|-------|-------------|--------|
| `session` | Session started | `id: string` |
| `token` | Streamed text | `text: string` |
| `tool_start` | Tool invoked | `name: string`, `input?: unknown` |
| `tool_delta` | Tool streaming | `text: string` |
| `tool_end` | Tool finished | `output?: string` |
| `end` | Task complete | `error?: string` |
| `agent_crashed` | Process crashed | `message?: string`, `output?: string` |

```typescript
type Event =
  | { type: "session"; id: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_delta"; text: string }
  | { type: "tool_end"; output?: string }
  | { type: "end"; error?: string }
  | { type: "agent_crashed"; message?: string; output?: string }
```

---

## Model selection

| Provider | Example | Docs |
|----------|---------|------|
| **Claude** | `model: "sonnet"` | [Claude Code models](https://code.claude.com/docs/en/model-config) |
| **Codex** | `model: "gpt-4o"` | [Codex CLI models](https://developers.openai.com/codex/models) |
| **Goose** | `model: "gpt-4o"` | [Goose providers](https://block.github.io/goose/docs/getting-started/providers) |
| **OpenCode** | `model: "openai/gpt-4o"` | [OpenCode models](https://opencode.ai/docs/models/) |
| **Gemini** | `model: "gemini-2.0-flash"` | [Gemini CLI model](https://geminicli.com/docs/cli/model) |
| **Pi** | `model: "sonnet"` or `model: "openai/gpt-4o"` | [Pi CLI models](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#providers--models) |

---

## How it works

1. **Sandbox** — Create a Daytona sandbox for isolated execution
2. **CLI install** — Provider CLI is installed in the sandbox automatically
3. **Background execution** — Agent runs via `nohup`, outputs to a log file
4. **Polling** — SDK polls the log file for new JSON events
5. **Completion** — A `.done` file signals when the agent finishes
6. **Cleanup** — You call `sandbox.delete()` when done

```
┌─────────────┐     ┌──────────────────────────────────────┐
│   Your App  │────▶│          Daytona Sandbox             │
│             │     │  ┌─────────────┐    ┌─────────────┐  │
│  (polling)  │◀────│  │  Log File   │◀───│  Agent CLI  │  │
│             │     │  └─────────────┘    └─────────────┘  │
└─────────────┘     └──────────────────────────────────────┘
```

---

## Debug mode

Set `CODING_AGENTS_DEBUG=1` to enable debug logging:

```bash
CODING_AGENTS_DEBUG=1 npx tsx your-script.ts
```

---

## Claude OAuth credentials

Claude can authenticate via `ANTHROPIC_API_KEY` or `CLAUDE_CODE_CREDENTIALS`. The latter uses OAuth credentials from a Claude Pro/Max subscription.

First, sign in locally:

```bash
claude auth login
```

Then retrieve your credentials:

| OS | Command |
|----|---------|
| macOS | `security find-generic-password -s "Claude Code-credentials" -w` |
| Linux | `cat ~/.claude/.credentials.json` |
| Windows | `type %USERPROFILE%\.claude\.credentials.json` |

Pass the output as `CLAUDE_CODE_CREDENTIALS`. The SDK automatically writes it to `~/.claude/.credentials.json` in the sandbox.

---

## Development

```bash
npm install
npm run build
npm test

# Integration tests (OpenCode — no provider key needed)
DAYTONA_API_KEY=... npm test -- tests/integration/polling-e2e.test.ts

# Integration tests (Claude — needs Anthropic key)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm test -- tests/integration/sandbox-background.test.ts

# Interactive REPL
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl-polling.ts
```

---

## Resources

**Sandbox** — [Daytona Docs](https://www.daytona.io/docs/) · [Daytona GitHub](https://github.com/daytonaio/daytona)

**Agents** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) · [Codex CLI](https://developers.openai.com/codex/cli) · [Gemini CLI](https://geminicli.com/docs/) · [Goose](https://block.github.io/goose/docs/) · [OpenCode](https://opencode.ai/docs/) · [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)

---

## License

MIT
