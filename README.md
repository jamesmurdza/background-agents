# Code Agent SDK

A TypeScript SDK for interacting with various AI coding agents (Claude, Codex, OpenCode, Gemini).

## Features

- Unified interface for multiple AI coding agents
- Async generator-based streaming events
- Session persistence and resumption
- Type-safe event handling
- Zero runtime dependencies

## Installation

```bash
npm install code-agent-sdk
```

## Quick Start

```typescript
import { createProvider } from "code-agent-sdk"

// Create a provider
const provider = createProvider("claude")

// Stream events using async generator
for await (const event of provider.run()) {
  switch (event.type) {
    case "session":
      console.log("Session started:", event.id)
      break
    case "token":
      process.stdout.write(event.text)
      break
    case "tool_start":
      console.log("\nTool started:", event.name)
      break
    case "tool_delta":
      process.stdout.write(event.text)
      break
    case "tool_end":
      console.log("\nTool ended")
      break
    case "end":
      console.log("\nMessage complete")
      break
  }
}
```

## Providers

The SDK supports the following AI coding agents:

| Provider | CLI Command | Description |
|----------|-------------|-------------|
| `claude` | `claude` | Anthropic's Claude Code |
| `codex` | `codex` | OpenAI's Codex |
| `opencode` | `opencode` | OpenCode CLI |
| `gemini` | `gemini` | Google's Gemini CLI |

## API Reference

### Factory Functions

#### `createProvider(name: ProviderName): Provider`

Create a provider instance by name.

```typescript
import { createProvider } from "code-agent-sdk"

const claude = createProvider("claude")
const codex = createProvider("codex")
```

#### `getProviderNames(): ProviderName[]`

Get all available provider names.

#### `isValidProvider(name: string): boolean`

Check if a provider name is valid.

### Provider Class

All providers extend the `Provider` base class and implement the `IProvider` interface.

#### `provider.run(options?: RunOptions): AsyncGenerator<Event>`

Run the provider and yield events.

```typescript
const provider = createProvider("claude")

for await (const event of provider.run({ persistSession: true })) {
  // Handle events
}
```

#### `provider.runWithCallback(callback, options?): Promise<void>`

Run with a callback for each event.

```typescript
await provider.runWithCallback((event) => {
  console.log(event)
})
```

#### `provider.collectEvents(options?): Promise<Event[]>`

Collect all events into an array.

```typescript
const events = await provider.collectEvents()
```

#### `provider.collectText(options?): Promise<string>`

Collect only text tokens into a string.

```typescript
const response = await provider.collectText()
console.log(response)
```

### Run Options

```typescript
interface RunOptions {
  // Session ID to resume
  sessionId?: string

  // Whether to persist session to file (default: true)
  persistSession?: boolean

  // Custom session file path
  sessionFile?: string

  // Working directory
  cwd?: string

  // Environment variables
  env?: Record<string, string>
}
```

### Event Types

```typescript
type Event =
  | { type: "session"; id: string }      // Session started
  | { type: "token"; text: string }      // Text token from assistant
  | { type: "tool_start"; name: string } // Tool invocation started
  | { type: "tool_delta"; text: string } // Tool input streaming
  | { type: "tool_end" }                 // Tool invocation ended
  | { type: "end" }                      // Message/turn complete
```

## Session Management

The SDK automatically manages session persistence:

```typescript
// Sessions are persisted by default
const provider = createProvider("claude")
await provider.collectText() // Creates and saves session

// Next run will resume the session automatically
await provider.collectText() // Resumes previous session

// Disable session persistence
await provider.collectText({ persistSession: false })

// Use a custom session file
await provider.collectText({ sessionFile: "./my-session" })

// Manually specify a session ID
await provider.collectText({ sessionId: "specific-session-id" })
```

### Session Utilities

```typescript
import { loadSession, storeSession, clearSession, getDefaultSessionPath } from "code-agent-sdk"

// Get default session path for a provider
const path = getDefaultSessionPath("claude")

// Load session from file
const sessionId = loadSession(path)

// Store session to file
storeSession(path, "session-id")

// Clear session file
clearSession(path)
```

## Direct Provider Usage

You can also use provider classes directly:

```typescript
import { ClaudeProvider, CodexProvider, GeminiProvider, OpenCodeProvider } from "code-agent-sdk"

const claude = new ClaudeProvider()
const codex = new CodexProvider()
const gemini = new GeminiProvider()
const opencode = new OpenCodeProvider()
```

## Environment Variables

Copy `.env.example` to `.env` and configure your API keys:

```bash
# Claude (Anthropic)
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Codex (OpenAI)
OPENAI_API_KEY=sk-your-key-here

# Gemini (Google)
GOOGLE_API_KEY=AIza-your-key-here

# OpenCode
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

# Run tests in watch mode
npm run test:watch
```

## License

MIT
