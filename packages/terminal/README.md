# @upstream/terminal

WebSocket-based PTY terminal for Daytona sandboxes. Provides a full interactive terminal experience using xterm.js, with automatic server setup inside the sandbox.

## Features

- **Full PTY support**: Run interactive programs like vim, htop, ssh, etc.
- **Real-time streaming**: Instant I/O via WebSocket
- **Terminal emulation**: Full ANSI color support, cursor positioning, scrollback
- **Resize handling**: Terminal automatically resizes to fit container
- **Web links**: Clickable URLs in terminal output
- **Theme support**: Light and dark mode
- **Zero-friction setup**: Server auto-installed in sandbox

## Installation

```bash
npm install @upstream/terminal @daytonaio/sdk
```

## Quick Start

```typescript
import { Daytona } from "@daytonaio/sdk"
import { setupTerminal, WebSocketTerminal } from "@upstream/terminal"

// 1. Create sandbox and set up terminal
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()
const { websocketUrl, status } = await setupTerminal(sandbox)

// 2. Use the WebSocket URL in your React component
if (status === "running" && websocketUrl) {
  return <WebSocketTerminal websocketUrl={websocketUrl} />
}
```

## API Reference

### Sandbox Setup Functions

#### `setupTerminal(sandbox, options?)`

Sets up and starts the PTY terminal server in a Daytona sandbox. Auto-installs dependencies (ws, node-pty) if needed.

```typescript
import { setupTerminal } from "@upstream/terminal"

const result = await setupTerminal(sandbox, {
  expiresIn: 3600,  // URL expiry in seconds (default: 3600)
  port: 44777,      // Server port (default: 44777)
})

// Result:
// {
//   status: "running" | "stopped" | "error",
//   websocketUrl?: string,  // wss:// URL for terminal connection
//   httpsUrl?: string,      // https:// URL for health checks
//   port: number,
//   error?: string,
//   details?: string,
// }
```

#### `getTerminalStatus(sandbox, options?)`

Check if the terminal server is running and get its URL.

```typescript
import { getTerminalStatus } from "@upstream/terminal"

const { status, websocketUrl } = await getTerminalStatus(sandbox)
```

#### `stopTerminal(sandbox)`

Stop the terminal server.

```typescript
import { stopTerminal } from "@upstream/terminal"

await stopTerminal(sandbox)
```

### React Component

#### `WebSocketTerminal`

```tsx
import { WebSocketTerminal } from '@upstream/terminal'

<WebSocketTerminal
  websocketUrl={websocketUrl}
  onConnect={(pid) => console.log('Connected, PID:', pid)}
  onDisconnect={() => console.log('Disconnected')}
  onError={(err) => console.error('Error:', err)}
  fontSize={14}
  theme={{
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
  }}
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `websocketUrl` | `string` | required | WebSocket URL to connect to |
| `className` | `string` | `''` | CSS class for container |
| `onConnect` | `(pid: number) => void` | - | Called when connected |
| `onDisconnect` | `(code?, reason?) => void` | - | Called when disconnected |
| `onError` | `(error: Error) => void` | - | Called on error |
| `theme` | `object` | - | Terminal color theme |
| `fontSize` | `number` | `13` | Font size in pixels |
| `fontFamily` | `string` | `'Menlo, Monaco, ...'` | Font family |

### Server Code (Advanced)

For custom deployments, you can access the raw server code:

```typescript
import { getPtyServerCode, getPtyServerPackageJson, PTY_SERVER_PORT } from "@upstream/terminal/server"

// Get the Node.js server code as a string
const serverCode = getPtyServerCode()

// Get the package.json for dependencies
const packageJson = getPtyServerPackageJson()

// Default port
console.log(PTY_SERVER_PORT) // 44777
```

## Protocol

Messages are JSON-encoded:

### Client -> Server

```typescript
// Send input to PTY
{ type: 'input', payload: 'ls -la\n' }

// Resize terminal
{ type: 'resize', cols: 80, rows: 24 }

// Health check
{ type: 'ping' }
```

### Server -> Client

```typescript
// PTY output
{ type: 'data', payload: '...' }

// Connection ready
{ type: 'ready', pid: 12345, shell: 'bash', cwd: '/home/daytona' }

// Process exited
{ type: 'exit', exitCode: 0, signal: null }

// Health check response
{ type: 'pong', timestamp: 1234567890 }
```

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│   Your App      │     │          Daytona Sandbox             │
│                 │     │  ┌─────────────────────────────────┐ │
│  setupTerminal()│────▶│  │  PTY Server (auto-installed)    │ │
│                 │     │  │  - node-pty for PTY             │ │
│  <WebSocket     │◀───▶│  │  - ws for WebSocket             │ │
│   Terminal />   │     │  └─────────────────────────────────┘ │
└─────────────────┘     └──────────────────────────────────────┘
```

## Requirements

- Node.js >= 18
- React >= 18
- `@daytonaio/sdk` >= 0.10.0 (for sandbox setup functions)

## License

MIT
