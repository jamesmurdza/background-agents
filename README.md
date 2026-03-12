# Code Agent SDK

A TypeScript SDK for interacting with various AI coding agents through a unified interface.

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

for await (const event of provider.run({ prompt: "Hello, world!" })) {
  switch (event.type) {
    case "session":
      console.log("Session:", event.id)
      break
    case "token":
      process.stdout.write(event.text)
      break
    case "tool_start":
      console.log("\n[Tool]", event.name)
      break
    case "tool_delta":
      process.stdout.write(event.text)
      break
    case "tool_end":
      console.log("[/Tool]")
      break
    case "end":
      console.log("\n[Done]")
      break
  }
}
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

### Collecting All Events

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")
const events = await provider.collectEvents({
  prompt: "List 3 colors"
})

const tokens = events
  .filter(e => e.type === "token")
  .map(e => e.text)
  .join("")

console.log(tokens)
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

// Disable persistence for one-off queries
await provider.collectText({
  prompt: "Quick question",
  persistSession: false
})
```

### Using Different Providers

```typescript
import { createProvider, getProviderNames, isValidProvider } from "code-agent-sdk"

// List available providers
console.log(getProviderNames()) // ["claude", "codex", "opencode", "gemini"]

// Check if provider exists
if (isValidProvider("claude")) {
  const provider = createProvider("claude")
  // ...
}

// Or use provider classes directly
import { ClaudeProvider, CodexProvider } from "code-agent-sdk"

const claude = new ClaudeProvider()
const codex = new CodexProvider()
```

### Auto-Installing CLIs

The SDK can automatically install missing CLI tools:

```typescript
import { createProvider } from "code-agent-sdk"

const provider = createProvider("claude")

// Auto-install Claude CLI if not found
await provider.collectText({
  prompt: "Hello",
  autoInstall: true  // Will run: npm install -g @anthropic-ai/claude-code
})
```

You can also check and manage installations manually:

```typescript
import {
  isCliInstalled,
  installProvider,
  getInstallationStatus,
  getPackageName
} from "code-agent-sdk"

// Check if a CLI is installed
if (!isCliInstalled("claude")) {
  console.log("Claude CLI not found")
  console.log("Package:", getPackageName("claude")) // @anthropic-ai/claude-code

  // Install it
  installProvider("claude")
}

// Check all providers at once
const status = getInstallationStatus()
console.log(status)
// { claude: true, codex: true, opencode: false, gemini: false }
```

## API Reference

### `createProvider(name: ProviderName): Provider`

Factory function to create a provider instance.

```typescript
const provider = createProvider("claude") // or "codex", "opencode", "gemini"
```

### `provider.run(options?): AsyncGenerator<Event>`

Stream events as an async generator.

```typescript
for await (const event of provider.run({ prompt: "Hello" })) {
  // Handle events
}
```

### `provider.runWithCallback(callback, options?): Promise<void>`

Run with a callback for each event.

```typescript
await provider.runWithCallback((event) => console.log(event), { prompt: "Hello" })
```

### `provider.collectText(options?): Promise<string>`

Collect all text tokens into a single string.

```typescript
const text = await provider.collectText({ prompt: "Hello" })
```

### `provider.collectEvents(options?): Promise<Event[]>`

Collect all events into an array.

```typescript
const events = await provider.collectEvents({ prompt: "Hello" })
```

### Run Options

```typescript
interface RunOptions {
  prompt?: string              // The prompt to send
  sessionId?: string           // Session ID to resume
  persistSession?: boolean     // Save session to file (default: true)
  sessionFile?: string         // Custom session file path
  cwd?: string                 // Working directory
  env?: Record<string, string> // Environment variables
  autoInstall?: boolean        // Auto-install CLI if missing (default: false)
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

## CLI Requirements

Each provider requires its respective CLI to be installed:

### Claude

```bash
npm install -g @anthropic-ai/claude-code
export ANTHROPIC_API_KEY=sk-ant-...
```

### Codex

```bash
npm install -g @openai/codex
echo $OPENAI_API_KEY | codex login --with-api-key
```

### Gemini

```bash
npm install -g @google/gemini-cli
export GOOGLE_API_KEY=AIza...
```

### OpenCode

```bash
# Install opencode CLI
export OPENCODE_API_KEY=...
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run integration tests
npx tsx scripts/test-claude.ts
npx tsx scripts/test-codex.ts
```

## Environment Variables

Copy `.env.example` to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
OPENAI_API_KEY=sk-your-key-here
GOOGLE_API_KEY=AIza-your-key-here
OPENCODE_API_KEY=your-key-here
```

## License

MIT
