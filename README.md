# Code Agent SDK

A TypeScript SDK for interacting with AI coding agents ([Claude](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Gemini](https://geminicli.com/docs/), [OpenCode](https://opencode.ai/docs/)) through a unified interface. **All commands run in secure [Daytona](https://daytona.io) sandboxes by default** with real-time PTY streaming.

## Features

- **Secure by default** - All CLI execution happens in isolated Daytona sandboxes
- **Real-time streaming** - PTY-based streaming for live token output
- **Unified interface** - Same API for Claude, Codex, Gemini, and OpenCode
- **Auto-install** - CLIs are automatically installed in sandboxes
- **Session persistence** - Resume conversations across runs

## Provider Support

| Provider | Status | CLI | Authentication |
|----------|--------|-----|----------------|
| [Claude](https://docs.anthropic.com/en/docs/claude-code) | ✅ **Complete** | `claude` | `ANTHROPIC_API_KEY` env var |
| [Codex](https://developers.openai.com/codex/cli) | ✅ **Complete** | `codex` | `OPENAI_API_KEY` env var |
| [OpenCode](https://opencode.ai/docs/) | ✅ **Complete** | `opencode` | Provider-specific env vars (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) |
| [Gemini](https://geminicli.com/docs/) | 🚧 In progress | `gemini` | `GOOGLE_API_KEY` env var |

## Installation

```bash
npm install code-agent-sdk
```

## Prerequisites

You'll need a [Daytona](https://daytona.io) API key for sandbox mode (recommended):

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

If you prefer to run locally without a sandbox, see [Local Mode](#local-mode-dangerous) below.

## Quick Start

### 1. Create a Sandbox

```typescript
import { createSandbox, createProvider } from "code-agent-sdk"

// Create sandbox with your API keys
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
})

await sandbox.create()
```

### 2. Create a Provider

```typescript
const claude = createProvider("claude", { sandbox })
```

### 3. Stream Responses

```typescript
for await (const event of claude.run({ prompt: "Hello!" })) {
  if (event.type === "token") {
    process.stdout.write(event.text)
  }
  if (event.type === "tool_start") {
    console.log(`\n[Tool: ${event.name}]`)  // event.input is typed by name
  }
  if (event.type === "end") break
}
```

### 4. Cleanup

```typescript
await sandbox.destroy()
```

## Full Example

```typescript
import { createSandbox, createProvider } from "code-agent-sdk"

async function main() {
  const sandbox = createSandbox({
    apiKey: process.env.DAYTONA_API_KEY,
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  })
  await sandbox.create()

  try {
    const provider = createProvider("claude", { sandbox })

    for await (const event of provider.run({ prompt: "List /tmp then write /tmp/out.txt with 'done'" })) {
      switch (event.type) {
        case "session":
          console.log("Session:", event.id)
          break
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          if (event.name === "shell" && event.input?.command) {
            console.log("\n[Running]", event.input.command)
          } else if (event.name === "write" && event.input?.file_path) {
            console.log("\n[Writing]", event.input.file_path)
          } else {
            console.log("\n[Tool]", event.name)
          }
          break
        case "tool_end":
          if (event.output) console.log("[Output]", event.output.slice(0, 80) + (event.output.length > 80 ? "…" : ""))
          break
        case "end":
          console.log("\nDone.")
          break
      }
    }
  } finally {
    await sandbox.destroy()
  }
}

main()
```

## API Reference

### createSandbox(config)

Creates a sandbox manager for secure CLI execution.

```typescript
const sandbox = createSandbox({
  apiKey: string,              // Daytona API key (required)
  serverUrl?: string,          // Daytona server URL
  target?: string,             // Target region
  autoStopTimeout?: number,    // Auto-stop timeout in seconds
  env?: Record<string, string> // Environment variables for CLI
})

await sandbox.create()         // Initialize the sandbox
await sandbox.destroy()        // Cleanup when done
```

### createProvider(name, options)

Creates a provider instance.

```typescript
// With sandbox (recommended)
const provider = createProvider("claude", { sandbox })

// With dangerous local execution (use with caution!)
const provider = createProvider("claude", {
  dangerouslyAllowLocalExecution: true
})
```

**Supported providers:** `"claude"`, `"codex"`, `"gemini"`, `"opencode"`

### provider.run(options)

Streams events from the AI agent.

```typescript
for await (const event of provider.run({
  prompt: string,              // The prompt to send
  model?: string,              // Model to use (provider-specific)
  sessionId?: string,          // Resume a previous session
  timeout?: number,            // Timeout in seconds (default: 120)
  autoInstall?: boolean,       // Auto-install CLI (default: true)
  env?: Record<string, string> // Additional env vars
})) {
  // Handle events
}
```

### Output format (event stream)

`provider.run()` yields an async iterable of **events**. Every provider emits the same event shapes so you can handle Claude, Codex, Gemini, and OpenCode uniformly.

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

| Tool     | tool_start `input` (normalized) | tool_end `output` | Claude | Codex | OpenCode | Gemini |
|----------|---------------------------------|--------------------|:-----:|:-----:|:--------:|:------:|
| **write** | `{ file_path: string, content: string \| null, kind: "add" \| "update" }` | Raw string (success message or JSON). | ✅ | ✅ | ✅ | ✅ |
| **read** | `{ file_path: string }` | File contents string. | ✅ | — | ✅ | ✅ |
| **edit** | `{ file_path: string, ... }` | Raw string. | ✅ | — | ✅ | ✅ |
| **glob** | `{ pattern: string }` | Raw string (paths or JSON). | ✅ | — | ✅ | ✅ |
| **grep** | `{ pattern: string, path?: string }` | Raw string. | ✅ | — | ✅ | ✅ |
| **shell** | `{ command: string, description?: string }` | Stdout/stderr string. | ✅ | ✅ | ✅ | ✅ |
| *(other)* | `unknown` (SDK passes through raw provider payload) | Raw string. | ✅ | ✅ | ✅ | ✅ |

The SDK emits typed events: when you narrow on `event.name`, `event.input` is typed (e.g. `"write"` → `WriteToolInput`, `"shell"` → `ShellToolInput`). You can import the input types for annotations or use narrowing alone:

```typescript
import {
  createSandbox,
  createProvider,
  type WriteToolInput,
  type ShellToolInput,
} from "code-agent-sdk"

for await (const event of provider.run({ prompt })) {
  if (event.type === "tool_start" && event.name === "write") {
    const input = event.input  // typed as WriteToolInput | undefined
    input?.file_path            // string
    input?.content              // string | null
    input?.kind                 // "add" | "update"
  }
  if (event.type === "tool_start" && event.name === "shell") {
    const input = event.input   // typed as ShellToolInput | undefined
    input?.command              // string
  }
  if (event.type === "tool_end" && event.output !== undefined) {
    // event.output: string
  }
}
```

Other exported types: `ToolName`, `ReadToolInput`, `EditToolInput`, `GlobToolInput`, `GrepToolInput`, `ToolInputMap`.

#### Example stream (write then end)

```json
{"type":"session","id":"abc-123"}
{"type":"token","text":"I'll write the file.\n"}
{"type":"tool_start","name":"write","input":{"file_path":"/tmp/hello.txt","content":"Hello","kind":"update"}}
{"type":"tool_end","output":"File created successfully."}
{"type":"token","text":"Done."}
{"type":"end"}
```

### Convenience Methods

```typescript
// Collect full text response
const text = await provider.collectText({ prompt: "Hello" })

// Collect all events
const events = await provider.collectEvents({ prompt: "Hello" })

// Callback style
await provider.runWithCallback((event) => {
  console.log(event)
}, { prompt: "Hello" })
```

## Model Selection

Each provider supports specifying a model via the `model` option. Pass the model identifier when calling `run()`:

### Claude Models

```typescript
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
})
await sandbox.create()

const claude = createProvider("claude", { sandbox })

// Use model alias (recommended)
await claude.run({ prompt: "Hello", model: "sonnet" })
await claude.run({ prompt: "Hello", model: "opus" })
await claude.run({ prompt: "Hello", model: "haiku" })

// Or use full model name
await claude.run({ prompt: "Hello", model: "claude-sonnet-4-5-20250929" })
```

See [Claude Code model configuration](https://code.claude.com/docs/en/model-config) for all available models.

### Codex Models

```typescript
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
})
await sandbox.create()

const codex = createProvider("codex", { sandbox })

await codex.run({ prompt: "Hello", model: "gpt-4o" })
await codex.run({ prompt: "Hello", model: "o1" })
await codex.run({ prompt: "Hello", model: "o3" })
```

See [Codex CLI models](https://developers.openai.com/codex/models) for all available models.

### Gemini Models

```typescript
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY },
})
await sandbox.create()

const gemini = createProvider("gemini", { sandbox })

await gemini.run({ prompt: "Hello", model: "gemini-2.0-flash" })
await gemini.run({ prompt: "Hello", model: "gemini-1.5-pro" })
```

See [Gemini CLI model selection](https://geminicli.com/docs/cli/model) for all available models.

### OpenCode Models

```typescript
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
})
await sandbox.create()

const opencode = createProvider("opencode", { sandbox })

// Format: "provider/model"
await opencode.run({ prompt: "Hello", model: "openai/gpt-4o" })           // Default
await opencode.run({ prompt: "Hello", model: "openai/gpt-4o-mini" })
await opencode.run({ prompt: "Hello", model: "openai/o1" })
await opencode.run({ prompt: "Hello", model: "openai/o3" })

// Other providers supported by OpenCode
await opencode.run({ prompt: "Hello", model: "anthropic/claude-sonnet" })
await opencode.run({ prompt: "Hello", model: "google/gemini-2.0-flash" })
```

See [OpenCode models](https://opencode.ai/docs/models/) for all available models and providers.

## Local Mode (Dangerous)

If you need to run CLIs directly on your machine (not recommended):

```typescript
const provider = createProvider("claude", {
  dangerouslyAllowLocalExecution: true,
})

// Runs claude CLI directly on your machine
const text = await provider.collectText({ prompt: "Hello" })
```

**Warning:** Local mode executes arbitrary CLI commands on your machine. Only use this when you fully trust the code being executed.

## Interactive REPL

Test the SDK interactively with any supported provider:

```bash
# Using Claude (default)
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/repl.ts

# Using Codex
DAYTONA_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/repl.ts --provider codex

# Using Gemini
DAYTONA_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/repl.ts --provider gemini

# Using OpenCode
DAYTONA_API_KEY=... OPENAI_API_KEY=... npx tsx scripts/repl.ts --provider opencode
```

### REPL Options

```bash
npx tsx scripts/repl.ts [options]

Options:
  -p, --provider <name>  Provider to use (default: claude)
  -h, --help             Show help message

Supported providers: claude, codex, gemini, opencode
```

### Example Session

```
============================================================
  Code Agent SDK - Interactive REPL
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

1. **Sandbox Creation**: A Daytona sandbox is created with your environment variables
2. **CLI Installation**: The provider CLI (claude, codex, etc.) is auto-installed in the sandbox
3. **PTY Streaming**: Commands run via PTY for real-time output streaming
4. **Event Parsing**: JSON output is parsed into typed events
5. **Cleanup**: Sandbox is destroyed when done

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
