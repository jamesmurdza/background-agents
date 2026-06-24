# Background Agents SDK

A TypeScript SDK for running AI coding agents (Claude, Codex, Copilot, Gemini, Goose, Kilo, Kimi, OpenCode, Pi) in secure [Daytona](https://daytona.io) sandboxes. Designed for background execution with polling-based event streaming.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@background-agents/sdk"

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
- **Unified API** — One interface for [Claude](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Copilot](https://docs.github.com/en/copilot), [Gemini](https://geminicli.com/docs/), [Goose](https://block.github.io/goose/docs/), [Kilo](https://kilo.codes/docs/), [Kimi](https://code.kimi.com/), [OpenCode](https://opencode.ai/docs/), and [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
- **Zero-friction setup** — Provider CLI auto-installed in sandbox
- **Session persistence** — Resume conversations across runs and restarts

---

## Provider support

| Provider | Status | Auth |
|----------|--------|------|
| [Claude](https://docs.anthropic.com/en/docs/claude-code) | ✅ | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_CREDENTIALS` |
| [Codex](https://developers.openai.com/codex/cli) | ✅ | `OPENAI_API_KEY` |
| [Copilot](https://docs.github.com/en/copilot) | ✅ | `COPILOT_GITHUB_TOKEN` |
| [Gemini](https://geminicli.com/docs/) | ✅ | `GEMINI_API_KEY` |
| [Goose](https://block.github.io/goose/docs/) | ✅ | Provider-specific (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) |
| [Kilo](https://kilo.codes/docs/) | ✅ | `KILO_API_KEY` or none (free models available) |
| [Kimi](https://code.kimi.com/) | ✅ | `KIMI_API_KEY` |
| [OpenCode](https://opencode.ai/docs/) | ✅ | `OPENCODE_API_KEY` or none (free models available) |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | ✅ | Provider-specific (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |
| Eliza | ✅ | None (deterministic test agent) |

### CLI reference commands

| Provider | CLI Command |
|----------|-------------|
| Claude | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions -- "prompt"` |
| Codex | `codex exec --json --skip-git-repo-check --yolo -- "prompt"` |
| Copilot | `copilot -p "prompt" --output-format=json --silent --autopilot` |
| Gemini | `gemini --output-format stream-json --skip-trust --yolo -p "prompt"` |
| Goose | `goose run --output-format stream-json --text "prompt"` |
| Kilo | `kilo run --format json --auto -- "prompt" 2>&1` |
| Kimi | `kimi -m <model> --output-format stream-json -p "prompt"` |
| OpenCode | `opencode run --format json --variant medium -- "prompt" 2>&1` |
| Pi | `pi --mode json -p "prompt"` |
| Eliza | Built-in deterministic agent (no CLI) |

---

## Prerequisites

A [Daytona](https://daytona.io) API key for secure sandboxed execution.

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

---

## Installation

```bash
npm install @background-agents/sdk @daytonaio/sdk
```

---

## Quick start

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@background-agents/sdk"

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
import { createSession, getSession } from "@background-agents/sdk"

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
const restoredSandbox = await daytona.get(sandboxId)
const restoredSession = await getSession(sessionId, { sandbox: restoredSandbox })

// Continue polling
const { events, running } = await restoredSession.getEvents()
for (const event of events) {
  if (event.type === "token") process.stdout.write(event.text)
}

// Cancel if needed
await restoredSession.cancel()
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

Starts a background task. Returns immediately with a `TurnHandle` (`{ executionId, pid, outputFile }`).

```typescript
const { executionId, pid, outputFile } = await session.start("Your task here")
```

### `session.getEvents()`

Polls for new events since last call.

```typescript
const { events, running, sessionId, cursor, runPhase } = await session.getEvents()
// events:    Event[]        - new events since last poll
// running:   boolean        - true if the agent is still running
// sessionId: string | null  - provider session id (once known)
// cursor:    string         - opaque pagination cursor for the next poll
// runPhase:  "idle" | "starting" | "running" | "stopped"
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
| **Claude** | `model: "sonnet"`, `model: "opus"`, `model: "haiku"` | [Claude Code](https://code.claude.com/docs/en/model-config#model-aliases) |
| **Codex** | `model: "gpt-5.4"`, `model: "gpt-5.3-codex"` | [Codex CLI models](https://developers.openai.com/codex/models) |
| **Copilot** | `model: "gpt-5-mini"`, `model: "claude-sonnet-4.5"`, `model: "o3"` | [GitHub Copilot](https://docs.github.com/en/copilot) |
| **Gemini** | `model: "gemini-2.5-flash"`, `model: "gemini-2.5-pro"`, `model: "gemini-3-pro-preview"` | [Gemini CLI model](https://geminicli.com/docs/cli/model) |
| **Goose** | `model: "gpt-4o"`, `model: "claude-sonnet-4-5"`, `model: "claude-opus-4-7"` | [Goose providers](https://block.github.io/goose/docs/getting-started/providers) |
| **Kilo** | `model: "kilo/kilo-auto/free"`, `model: "kilo/anthropic/claude-opus-4.7"` | [Kilo](https://kilo.codes/docs/) |
| **Kimi** | `model: "kimi-k2.7-code"`, `model: "kimi-k2.7-code-highspeed"`, `model: "kimi-k2.6"` | [Kimi Code](https://code.kimi.com/) |
| **OpenCode** | `model: "opencode/big-pickle"` (free), `model: "anthropic/claude-sonnet-4-5"` | [OpenCode models](https://opencode.ai/docs/models/) |
| **Pi** | `model: "claude-sonnet-4-5"`, `model: "openai/gpt-4o"`, `model: "google/gemini-2.5-pro"` | [Pi CLI models](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#providers--models) |

---

## How it works

1. **Sandbox** — Create a Daytona sandbox for isolated execution
2. **CLI install** — Provider CLI is installed in the sandbox automatically
3. **Background execution** — Agent runs via `nohup`, outputs to a log file
4. **Polling** — SDK polls the log file for new JSON events
5. **Completion** — An `exit` file (holding the process exit code) signals when the agent finishes
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

Build, test, and iterate locally. Start by installing dependencies and running the unit test suite:

```bash
npm install
npm run build
npm test
```

For integration and end-to-end testing, see [TESTING.md](./TESTING.md).

For testing scenarios, you can use the deterministic Eliza agent, which requires no provider API key.

---

## Resources

**Sandbox** — [Daytona Docs](https://www.daytona.io/docs/) · [Daytona GitHub](https://github.com/daytonaio/daytona)

**Agents** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) · [Codex CLI](https://developers.openai.com/codex/cli) · [GitHub Copilot](https://docs.github.com/en/copilot) · [Gemini CLI](https://geminicli.com/docs/) · [Goose](https://block.github.io/goose/docs/) · [Kilo](https://kilo.codes/docs/) · [Kimi](https://code.kimi.com/) · [OpenCode](https://opencode.ai/docs/) · [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)

---

## License

MIT
