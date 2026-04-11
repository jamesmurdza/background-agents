/**
 * PTY Server Code
 *
 * This module provides the WebSocket PTY server code that runs inside
 * a Daytona sandbox. The code is returned as a string so it can be
 * uploaded to the sandbox and executed there.
 *
 * The server uses:
 * - node-pty for pseudo-terminal support
 * - ws for WebSocket communication
 */

/** Default port for the PTY server */
export const PTY_SERVER_PORT = 44777

/**
 * Get the PTY server JavaScript code as a string.
 * This code is designed to run inside a sandbox with Node.js.
 */
export function getPtyServerCode(): string {
  return `
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const pty = require('node-pty');
const os = require('os');

const PORT = process.env.PTY_PORT || 44777;

// Custom rcfile that sources the user's bashrc and then overrides PS1.
// Setting PS1 only via the env doesn't work because interactive bash sources
// ~/.bashrc on startup and most distro bashrcs reset PS1 themselves.
// PS1 is single-quoted in the rcfile so bash doesn't interpret backslashes
// at parse time; the \\[...\\] markers tell readline these are non-printing
// bytes so cursor math stays correct. \\\\033[32m is green, \\\\033[0m resets.
const RCFILE = '/tmp/.pty-bashrc';
fs.writeFileSync(
  RCFILE,
  "[ -f ~/.bashrc ] && source ~/.bashrc\\nPS1='\\\\[\\\\033[32m\\\\]\\\\u:\\\\w\\\\$\\\\[\\\\033[0m\\\\] '\\n"
);

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('WebSocket PTY Server Running');
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server, path: '/', verifyClient: (info, cb) => cb(true) });

wss.on('connection', (ws, req) => {
  console.log('[WS] Connection from:', req.socket.remoteAddress);

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const shellArgs = os.platform() === 'win32' ? [] : ['--rcfile', RCFILE, '-i'];
  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  ptyProcess.onData((data) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', payload: data }));
      }
    } catch (e) {}
  });

  ws.send(JSON.stringify({ type: 'ready', pid: ptyProcess.pid }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'input') ptyProcess.write(parsed.payload);
      else if (parsed.type === 'resize') ptyProcess.resize(parsed.cols, parsed.rows);
    } catch (e) {}
  });

  ws.on('close', () => { ptyProcess.kill(); });
  ws.on('error', () => { ptyProcess.kill(); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[Server] Listening on port ' + PORT);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
`.trim()
}

/**
 * Get the package.json for the PTY server dependencies
 */
export function getPtyServerPackageJson(): string {
  return JSON.stringify({
    name: "websocket-pty-server",
    version: "1.0.0",
    dependencies: {
      ws: "^8.18.0",
      "node-pty": "^1.0.0",
    },
  })
}
