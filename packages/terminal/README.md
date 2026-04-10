# @upstream/terminal

WebSocket-based PTY terminal for Daytona sandboxes. Provides a full interactive terminal experience using xterm.js.

## Features

- **Full PTY support**: Run interactive programs like vim, htop, ssh, etc.
- **Real-time streaming**: Instant I/O via WebSocket
- **Terminal emulation**: Full ANSI color support, cursor positioning, scrollback
- **Resize handling**: Terminal automatically resizes to fit container
- **Web links**: Clickable URLs in terminal output
- **Theme support**: Light and dark mode

## Architecture

This package provides the **client-side** xterm.js React component. The PTY server code is inlined in the API route (`/api/sandbox/terminal`) to avoid bundling native modules in Next.js.

## Usage

```tsx
import { WebSocketTerminal } from '@upstream/terminal';

function MyTerminal({ websocketUrl }: { websocketUrl: string }) {
  return (
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
  );
}
```

## Props

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

## Requirements

- React >= 18
- A WebSocket PTY server running in the sandbox (set up via `/api/sandbox/terminal`)
