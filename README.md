# Coding Agents SDK

A unified TypeScript interface for AI coding agents—Claude, Codex, Gemini, and OpenCode. Commands run in secure [Daytona](https://daytona.io) sandboxes by default, with real-time PTY streaming.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
})

for await (const event of session.run("Hello!")) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "end") break
}

await sandbox.delete()
```

Same pattern for any provider: create a sandbox, create a session, stream events, then tear down. Swap the provider name and env keys as needed.

---

## Features

- **Secure by default** — Execution runs in isolated Daytona sandboxes
- **Real-time streaming** — PTY-based streaming for live token output
- **Unified API** — One interface for [Claude](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Gemini](https://geminicli.com/docs/), and [OpenCode](https://opencode.ai/docs/)
- **Zero-friction setup** — Provider CLI is installed when you create a session (`skipInstall: true` to skip). Env and Codex login run on every `run()`.
- **Session persistence** — Resume conversations across runs

---

## Provider support

| Provider | Status | Auth |
|----------|--------|------|
| [Claude](https://docs.anthropic.com/en/docs/claude-code) | ✅ | `ANTHROPIC_API_KEY` |
| [Codex](https://developers.openai.com/codex/cli) | ✅ | `OPENAI_API_KEY` |
| [OpenCode](https://opencode.ai/docs/) | ✅ | Provider-specific (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) |
| [Gemini](https://geminicli.com/docs/) | 🚧 | `GEMINI_API_KEY` |

---

## Prerequisites

A [Daytona](https://daytona.io) API key (or [run locally](#local-mode-dangerous) without a sandbox).

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

---

## Installation

```bash
npm install @jamesmurdza/coding-agents-sdk
```

For sandboxed execution, also install the Daytona SDK:

```bash
npm install @daytonaio/sdk
```

**Next.js:** Merge the SDK's Next config so native deps (e.g. `ssh2` / `cpu-features`) are not bundled:

```js
// next.config.js or next.config.mjs
import codeagentsdk from '@jamesmurdza/coding-agents-sdk/next.config'
export default { ...codeagentsdk, ...yourConfig }
```

---

## Quick start

**1. Create a sandbox** — The SDK does not read your host env; pass API keys when creating the session.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()
```

**2. Create a session** — The provider CLI is installed in the sandbox (unless `skipInstall: true`). Pass environment variables at session creation.

```typescript
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet",
  timeout: 120,
  systemPrompt: "You are a helpful coding assistant.",
})
```

**3. Stream responses**

```typescript
for await (const event of session.run("Hello!")) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
  if (event.type === "end") break
}
```

**4. Cleanup**

```typescript
await sandbox.delete()
```

**Optional: Git workflow** — Use the [Daytona Git SDK](https://www.daytona.io/docs/en/typescript-sdk/git/) to clone before and push after:

```typescript
const repoPath = "workspace/repo"
await sandbox.git.clone("https://github.com/user/repo.git", repoPath)
// ... run session ...
await sandbox.git.push(repoPath)
```

---

## Full example

End-to-end example with event handling and cleanup:

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "@jamesmurdza/coding-agents-sdk"

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  const sandbox = await daytona.create()

  try {
    const session = await createSession("claude", {
      sandbox,
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    })

    for await (const event of session.run("List /tmp then write /tmp/out.txt with 'done'")) {
      switch (event.type) {
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          console.log("\n🛠️", event.name, event.input ?? "")
          break
        case "end":
          console.log("\nDone.")
          break
      }
    }
  } finally {
    await sandbox.delete()
  }
}

main()
```

### CLI commands (reference)

Each provider is invoked via its CLI. Optional flags in brackets.

| Provider | Command |
|----------|---------|
| **Claude** | `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` `[--model <m>] [--resume <id>]` `<prompt>` |
| **Codex** | `codex exec --json --skip-git-repo-check --yolo` `[--model <m>] [--resume <id>]` `<prompt>` |
| **OpenCode** | `opencode run --format json --variant medium -m <model>` `[-s <id>]` `<prompt>` (via `bash -lc "…"`) |
| **Gemini** | `gemini -p --output-format stream-json --yolo` `[--model <m>] [--resume <id>]` `<prompt>` |

---

## API reference

### `createSession(provider, options)`

Creates a session with the given provider and options (e.g. `sandbox`, `env`, `model`, `timeout`, `systemPrompt`). Installs the provider CLI in the sandbox before returning unless `skipInstall: true`. Codex login runs automatically on each `run()` when needed.

```typescript
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: "sk-..." },  // Session-level env (persistent)
  model: "sonnet",
  timeout: 120,
  systemPrompt: "You are a helpful coding assistant.",
})
```

### `session.run(prompt)`

Returns an async iterable of events. Stream and handle them uniformly across providers.

```typescript
for await (const event of session.run("Hello")) {
  // event.type: "session" | "token" | "tool_start" | "tool_delta" | "tool_end" | "end" | "agent_crashed"
}
```

### Event stream

| Event | Description | Fields |
|-------|-------------|--------|
| `session` | Session started (for resumption) | `id: string` |
| `token` | Streamed assistant text | `text: string` |
| `tool_start` | Tool invoked | `name: string`, `input?: unknown` |
| `tool_delta` | Streaming tool input | `text: string` |
| `tool_end` | Tool finished | `output?: string` |
| `end` | Turn complete | — |
| `agent_crashed` | Process exited without completing (crash/kill) | `message?: string`, `output?: string` (raw tail of stdout/stderr; often not JSONL) |

```typescript
type Event =
  | { type: "session"; id: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_delta"; text: string }
  | { type: "tool_end"; output?: string }
  | { type: "end" }
  | { type: "agent_crashed"; message?: string; output?: string }
```

### Normalized tool names

Tool names are normalized across providers. Each has a defined `tool_start` input and `tool_end` output.

| Tool | `tool_start` input | Claude | Codex | OpenCode |
|------|--------------------|:------:|:-----:|:--------:|
| **write** | `{ file_path, content?, kind }` | ✅ | ✅ | ✅ |
| **read** | `{ file_path }` | ✅ | — | ✅ |
| **edit** | `{ file_path, ... }` | ✅ | — | ✅ |
| **glob** | `{ pattern }` | ✅ | — | ✅ |
| **grep** | `{ pattern, path? }` | ✅ | — | ✅ |
| **shell** | `{ command, description? }` | ✅ | ✅ | ✅ |

---

## Environment variables

Pass environment variables at **session creation** (not sandbox creation):

```typescript
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: "sk-..." }
})
```

Override per-run if needed:

```typescript
await session.run({
  prompt: "Task",
  env: { ANTHROPIC_API_KEY: "sk-override-..." }
})
```

---

## Model selection

Set `model` when creating the session.

| Provider | Example | Docs |
|----------|---------|------|
| **Claude** | `model: "sonnet"` or `"opus"`, `"haiku"` | [Claude Code models](https://code.claude.com/docs/en/model-config) |
| **Codex** | `model: "gpt-4o"` or `"o1"`, `"o3"` | [Codex CLI models](https://developers.openai.com/codex/models) |
| **OpenCode** | `model: "openai/gpt-4o"` (provider/model) | [OpenCode models](https://opencode.ai/docs/models/) |
| **Gemini** | `model: "gemini-2.0-flash"` or `"gemini-1.5-pro"` | [Gemini CLI model](https://geminicli.com/docs/cli/model) |

---

## Sandboxed background sessions

For long-running or restart-tolerant flows: start the agent in the sandbox, write the event stream to log files there, and poll with **getEvents**. All state except the session ID lives in the sandbox.

- **Session ID** — One UUID per background session; host stores only this.
- **start()** — Returns immediately with `{ executionId, pid, outputFile }`; the agent runs in the background.
- **isRunning()** — True while the turn is in progress, false after.
- **Crash detection** — If the process exits without completing, **getEvents** returns an `agent_crashed` event. You can treat it like `end` to stop polling and show a warning.

**Example:** start, persist `sandboxId` and `backgroundSessionId`, then reattach after a restart.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createBackgroundSession, getBackgroundSession } from "@jamesmurdza/coding-agents-sdk"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
const sandbox = await daytona.create()

const bgSession = await createBackgroundSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  model: "sonnet",
  // Optional: per-session system prompt (applied once, persisted across turns).
  systemPrompt: "You are a helpful coding assistant.",
})
await bgSession.start("Do a long-running refactor...")
// Persist sandbox.id and bgSession.id, then exit.

// --- After restart ---
const sandboxAgain = await daytona.get(sandboxId)
const bgAgain = await getBackgroundSession({
  sandbox: sandboxAgain,
  backgroundSessionId,
  // Re-apply session options so the provider is recreated with the same env,
  // model, and system prompt when reattaching.
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  model: "sonnet",
  systemPrompt: "You are a helpful coding assistant.",
})

async function poll() {
  const { events } = await bgAgain.getEvents()
  for (const e of events) {
    if (e.type === "token") process.stdout.write(e.text)
    else if (e.type === "tool_start") console.log("[Tool]", e.name)
  }
  if (!(await bgAgain.isRunning())) return
  setTimeout(poll, 2000)
}
poll()

await bgAgain.cancel() // kill agent in sandbox (no-op if stopped)
```

---

## Local mode (dangerous)

Runs the provider CLI on your machine instead of a sandbox. Only use when you fully trust the code.

```typescript
const session = await createSession("claude", { dangerouslyAllowLocalExecution: true })
for await (const event of session.run("Hello")) {
  if (event.type === "token") process.stdout.write(event.text)
}
```

---

## Interactive REPL

```bash
# Claude (default)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl.ts

# Other providers
npx tsx scripts/repl.ts --provider codex   # OPENAI_API_KEY
npx tsx scripts/repl.ts --provider opencode
npx tsx scripts/repl.ts --provider gemini  # GEMINI_API_KEY

# Polling-based (background session)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl-polling.ts
```

```bash
npx tsx scripts/repl.ts -h   # help; providers: claude, codex, opencode, gemini
```

---

## How it works

1. **Sandbox** — You create a Daytona sandbox and pass it to `createSession`.
2. **CLI** — Provider CLI is installed in the sandbox at session creation (unless `skipInstall: true`). Each `run()` sets env and, for Codex, runs `codex login --with-api-key`.
3. **PTY** — Commands run in a PTY for real-time streaming.
4. **Events** — JSON from the CLI is parsed into typed events.
5. **Cleanup** — You call `sandbox.delete()` when done.

```
┌─────────────┐     ┌──────────────────────────────────────┐
│   Your App  │────▶│          Daytona Sandbox             │
│             │◀────│  ┌─────────────┐    ┌─────────────┐  │
│             │     │  │  PTY Stream │◀──▶│  Agent CLI  │  │
│             │     │  └─────────────┘    └─────────────┘  │
└─────────────┘     └──────────────────────────────────────┘
```

---

## Debug mode

Set `CODING_AGENTS_DEBUG=1` (or any non-empty value) to log debugging information to stderr:

- **Agent lifecycle** — when sessions and background sessions are created, when runs start and end
- **Background agents** — when a turn starts (session dir, turn number, output file), when the background process is started (pid), and each time events are polled (cursor, event count)
- **Unparsed output** — any CLI line that didn’t parse as an event (helps spot hangs where the agent prints something the SDK doesn’t recognize)

```bash
CODING_AGENTS_DEBUG=1 npx tsx scripts/repl-polling.ts
```

---

## Development

```bash
npm install
npm run build
npm test                    # unit tests (integration/sandbox-background skipped without keys)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npm run test -- tests/integration/sandbox-background.test.ts   # real sandbox background test
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/test-sdk-full.ts   # integration
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl.ts            # REPL
```

---

## Resources

**Sandbox** — [Daytona Docs](https://www.daytona.io/docs/) · [Daytona GitHub](https://github.com/daytonaio/daytona)

**Agents** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code) · [Codex CLI](https://developers.openai.com/codex/cli) · [Gemini CLI](https://geminicli.com/docs/) · [OpenCode](https://opencode.ai/docs/)

---

## License

MIT
