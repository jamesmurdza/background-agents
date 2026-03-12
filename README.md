# Code Agent SDK

A TypeScript SDK for interacting with AI coding agents (Claude, Codex, OpenCode, Gemini) through a unified interface. **All commands run in secure [Daytona](https://daytona.io) sandboxes by default** with real-time PTY streaming.

## Features

- **Secure by default** - All CLI execution happens in isolated Daytona sandboxes
- **Real-time streaming** - PTY-based streaming for live token output
- **Unified interface** - Same API for Claude, Codex, OpenCode, and Gemini
- **Auto-install** - CLIs are automatically installed in sandboxes
- **Session persistence** - Resume conversations across runs

## Provider Support

| Provider | Status | CLI | Authentication |
|----------|--------|-----|----------------|
| Claude | **Tested** | `claude` | `ANTHROPIC_API_KEY` env var |
| Codex | **Tested** | `codex` | `OPENAI_API_KEY` env var |
| OpenCode | Implemented | `opencode` | `OPENCODE_API_KEY` env var |
| Gemini | Implemented | `gemini` | `GOOGLE_API_KEY` env var |

## Installation

```bash
npm install code-agent-sdk
```

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
    process.stdout.write(event.text)  // Real-time streaming!
  }
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
  // 1. Create sandbox
  const sandbox = createSandbox({
    apiKey: process.env.DAYTONA_API_KEY,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    },
  })

  await sandbox.create()

  try {
    // 2. Create provider
    const claude = createProvider("claude", { sandbox })

    // 3. Stream response
    console.log("Claude: ")
    for await (const event of claude.run({ prompt: "Write a haiku about coding" })) {
      switch (event.type) {
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          console.log(`\n[Using tool: ${event.name}]`)
          break
        case "end":
          console.log("\n")
          break
      }
    }
  } finally {
    // 4. Always cleanup
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

**Supported providers:** `"claude"`, `"codex"`, `"opencode"`, `"gemini"`

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

### Event Types

```typescript
type Event =
  | { type: "session"; id: string }      // Session started
  | { type: "token"; text: string }      // Text token (streamed)
  | { type: "tool_start"; name: string } // Tool invocation started
  | { type: "tool_delta"; text: string } // Tool input streaming
  | { type: "tool_end" }                 // Tool invocation ended
  | { type: "end" }                      // Turn complete
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
const claude = createProvider("claude", { sandbox })

// Use model alias (recommended)
await claude.run({ prompt: "Hello", model: "sonnet" })
await claude.run({ prompt: "Hello", model: "opus" })
await claude.run({ prompt: "Hello", model: "haiku" })

// Or use full model name
await claude.run({ prompt: "Hello", model: "claude-sonnet-4-5-20250929" })
```

### OpenCode Models (OpenAI)

```typescript
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

### Codex Models

```typescript
const codex = createProvider("codex", { sandbox })

await codex.run({ prompt: "Hello", model: "gpt-4o" })
await codex.run({ prompt: "Hello", model: "o1" })
await codex.run({ prompt: "Hello", model: "o3" })
```

### Gemini Models

```typescript
const gemini = createProvider("gemini", { sandbox })

await gemini.run({ prompt: "Hello", model: "gemini-2.0-flash" })
await gemini.run({ prompt: "Hello", model: "gemini-1.5-pro" })
```

## Environment Variables

```bash
# Required for sandbox mode
DAYTONA_API_KEY=dtn_your_api_key

# Provider API keys (pass to sandbox via env config)
ANTHROPIC_API_KEY=sk-ant-...    # For Claude
OPENAI_API_KEY=sk-...           # For Codex and OpenCode
GOOGLE_API_KEY=AIza...          # For Gemini
```

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

Supported providers: claude, codex, opencode, gemini
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

## License

MIT
