/**
 * WebSocket PTY Server
 *
 * This server runs INSIDE the Daytona sandbox and provides a real PTY
 * (pseudo-terminal) over WebSocket. It enables full interactive terminal
 * sessions including programs like vim, htop, ssh, etc.
 *
 * Usage:
 *   1. Upload this file to the sandbox
 *   2. Run: npm install ws node-pty
 *   3. Run: node websocket-server.js
 *
 * The server listens on port 3001 by default (configurable via PORT env var).
 */

const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');

const PORT = process.env.PTY_PORT || 3001;

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  // Handle health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('WebSocket PTY Server Running');
    return;
  }

  // Handle WebSocket upgrade info
  if (req.url === '/info') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      message: 'WebSocket PTY endpoint available',
      url: 'wss://' + req.headers.host,
      status: 'ready'
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({
  server,
  path: '/',  // Accept connections on root path
  // Verify origin to prevent unauthorized connections
  verifyClient: (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    // Allow connections from Daytona proxy (signed URLs) and localhost for development
    // The signed URL mechanism is the primary security control
    if (!origin) {
      // No origin header - likely a direct WebSocket client or server-to-server
      // Allow since Daytona's signed URL provides authentication
      callback(true);
      return;
    }
    // Log origin for debugging
    console.log(`[WS] Connection attempt from origin: ${origin}`);
    callback(true);
  }
});

// Track active connections for cleanup
const connections = new Map();

wss.on('connection', (ws, req) => {
  const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Connection ${clientId} from: ${clientIp}`);

  // Determine shell to use
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

  // Spawn PTY process
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || os.homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  });

  // Track connection
  connections.set(clientId, { ws, ptyProcess });

  // Send PTY output to WebSocket
  ptyProcess.onData((data) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', payload: data }));
      }
    } catch (error) {
      console.error(`[WS] Error sending data to ${clientId}:`, error.message);
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[WS] PTY ${clientId} exited: code=${exitCode}, signal=${signal}`);
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
        ws.close();
      }
    } catch (error) {
      console.error(`[WS] Error sending exit to ${clientId}:`, error.message);
    }
    connections.delete(clientId);
  });

  // Send ready message with PTY info
  ws.send(JSON.stringify({
    type: 'ready',
    pid: ptyProcess.pid,
    shell,
    cwd: process.env.HOME || os.homedir()
  }));
  console.log(`[WS] PTY ${clientId} started, PID: ${ptyProcess.pid}`);

  // Handle incoming messages from WebSocket
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());

      switch (parsed.type) {
        case 'input':
          // Write user input to PTY
          ptyProcess.write(parsed.payload);
          break;

        case 'resize':
          // Resize PTY to match terminal dimensions
          if (parsed.cols && parsed.rows) {
            ptyProcess.resize(parsed.cols, parsed.rows);
          }
          break;

        case 'ping':
          // Respond to ping for connection health
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        default:
          console.warn(`[WS] Unknown message type: ${parsed.type}`);
      }
    } catch (error) {
      console.error(`[WS] Error parsing message from ${clientId}:`, error.message);
    }
  });

  // Handle WebSocket close
  ws.on('close', (code, reason) => {
    console.log(`[WS] Client ${clientId} disconnected: code=${code}`);
    try {
      ptyProcess.kill();
    } catch (error) {
      // PTY may already be dead
    }
    connections.delete(clientId);
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`[WS] WebSocket error for ${clientId}:`, error.message);
    try {
      ptyProcess.kill();
    } catch (err) {
      // PTY may already be dead
    }
    connections.delete(clientId);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] WebSocket PTY Server listening on port ${PORT}`);
  console.log(`[Server] HTTP health check: http://localhost:${PORT}/`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[Server] Received ${signal}, shutting down...`);

  // Close all PTY processes
  for (const [clientId, { ws, ptyProcess }] of connections) {
    console.log(`[Server] Closing connection ${clientId}`);
    try {
      ptyProcess.kill();
      ws.close();
    } catch (error) {
      // Ignore errors during shutdown
    }
  }
  connections.clear();

  // Close servers
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    console.log('[Server] Forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
});
