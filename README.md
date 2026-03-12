# Code Agent SDK

A TypeScript SDK for interacting with various AI coding agents through a unified interface. **By default, all commands run in a secure Daytona sandbox** to prevent arbitrary code execution on your local machine.

## Provider Support

| Provider | Status | CLI | Authentication |
|----------|--------|-----|----------------|
| Claude | **Tested** | `claude` | `ANTHROPIC_API_KEY` env var |
| Codex | **Tested** | `codex` | `codex login --with-api-key` or device auth |
| OpenCode | Implemented | `opencode` | `OPENCODE_API_KEY` env var |
| Gemini | Implemented | `gemini` | `GOOGLE_API_KEY` env var |

## Installation

```bash
npm install code-agent-sdk
```

## Quick Start

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")

// Runs in Daytona sandbox by default (secure)
for await (const event of provider.run({ prompt: "Hello, world!" })) {
  switch (event.type) {
    case "token":
      process.stdout.write(event.text)
      break
    case "end":
      console.log("\n[Done]")
      break
  }
}
```

## Execution Modes

### Sandbox Mode (Default - Recommended)

By default, all providers run inside a secure [Daytona](https://daytona.io) sandbox. This isolates the CLI execution from your local machine.

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")

// Sandbox mode is the default
const response = await provider.collectText({
  prompt: "What is 2 + 2?",
  // mode: "sandbox" is implicit
})
```

Configure the sandbox:

```typescript
const response = await provider.collectText({
  prompt: "Hello",
  sandbox: {
    apiKey: process.env.DAYTONA_API_KEY,  // Or set DAYTONA_API_KEY env var
    serverUrl: "https://api.daytona.io",
    autoStopTimeout: 300, // Auto-stop after 5 minutes of inactivity
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    },
  },
})
```

### Local Mode (Opt-in - Use with Caution)

If you need to run locally (e.g., for development or when you trust the code), explicitly opt-in:

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")

// ⚠️ Runs directly on your local machine
const response = await provider.collectText({
  prompt: "Hello",
  mode: "local",  // Explicitly opt-in to local execution
})
```

## Example Usage

### Simple Text Response

```typescript
import { createProvider } from "code-agent-sdk"

const claude = createProvider("claude")
const response = await claude.collectText({
  prompt: "What is 2 + 2?"
})
console.log(response) // "4"
```

### Streaming with Callbacks

```typescript
import { createProvider } from "code-agent-sdk"

const codex = createProvider("codex")

await codex.runWithCallback((event) => {
  if (event.type === "token") {
    process.stdout.write(event.text)
  }
}, { prompt: "Explain recursion briefly" })
```

### Using the Sandbox Directly

```typescript
import { createSandbox } from "code-agent-sdk"

const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
})

// Install a CLI
await sandbox.ensureProvider("claude")

// Execute commands
const result = await sandbox.executeCommand("claude --version")
console.log(result.output)

// Stream command output
for await (const line of sandbox.executeCommandStream("claude -p 'Hello'")) {
  console.log(line)
}

// Cleanup when done
await sandbox.destroy()
```

### Session Persistence

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")

// First interaction - session is saved automatically
await provider.collectText({ prompt: "Remember: my name is Alice" })

// Second interaction - resumes the same session
const response = await provider.collectText({ prompt: "What's my name?" })
console.log(response) // Should remember "Alice"
```

## API Reference

### Run Options

```typescript
interface RunOptions {
  prompt?: string              // The prompt to send
  sessionId?: string           // Session ID to resume
  persistSession?: boolean     // Save session to file (default: true)
  sessionFile?: string         // Custom session file path
  cwd?: string                 // Working directory
  env?: Record<string, string> // Environment variables
  autoInstall?: boolean        // Auto-install CLI if missing (default: true in sandbox, false in local)
  mode?: "sandbox" | "local"   // Execution mode (default: "sandbox")
  sandbox?: SandboxConfig      // Sandbox configuration
}

interface SandboxConfig {
  apiKey?: string              // Daytona API key (or DAYTONA_API_KEY env var)
  serverUrl?: string           // Daytona server URL
  target?: string              // Target region
  autoStopTimeout?: number     // Auto-stop timeout in seconds
  env?: Record<string, string> // Environment variables for the sandbox
}
```

### Event Types

```typescript
type Event =
  | { type: "session"; id: string }      // Session started
  | { type: "token"; text: string }      // Text from assistant
  | { type: "tool_start"; name: string } // Tool invocation started
  | { type: "tool_delta"; text: string } // Tool input streaming
  | { type: "tool_end" }                 // Tool invocation ended
  | { type: "end" }                      // Turn complete
```

### Provider Methods

```typescript
// Stream events
for await (const event of provider.run(options)) { }

// Callback style
await provider.runWithCallback(callback, options)

// Collect all text
const text = await provider.collectText(options)

// Collect all events
const events = await provider.collectEvents(options)

// Cleanup sandbox resources
await provider.destroySandbox()
```

## Environment Variables

```bash
# Daytona (for sandbox mode)
DAYTONA_API_KEY=your-daytona-api-key

# Provider API keys (passed to sandbox or local CLI)
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
OPENAI_API_KEY=sk-your-key-here
GOOGLE_API_KEY=AIza-your-key-here
OPENCODE_API_KEY=your-key-here
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run integration tests (local mode)
npx tsx scripts/test-claude.ts
npx tsx scripts/test-codex.ts
```

## Security

- **Sandbox mode (default)**: CLI commands run in an isolated Daytona sandbox, protecting your local machine from arbitrary code execution
- **Local mode (opt-in)**: Commands run directly on your machine - only use this when you trust the code being executed
- **Auto-install**: In sandbox mode, CLIs are automatically installed in the sandbox (not on your machine)

## License

MIT
