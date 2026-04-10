/**
 * @upstream/terminal
 *
 * WebSocket-based PTY terminal for Daytona sandboxes.
 *
 * This package provides an xterm.js-based React component that connects
 * to a WebSocket PTY server running inside a Daytona sandbox.
 *
 * The PTY server code is inlined in the API route to avoid bundling
 * native modules (node-pty) in the Next.js build.
 *
 * Usage:
 *    import { WebSocketTerminal } from '@upstream/terminal';
 *    <WebSocketTerminal websocketUrl={wsUrl} />
 */

// Re-export components
export { WebSocketTerminal } from './components/WebSocketTerminal';
export type { WebSocketTerminalProps } from './components/WebSocketTerminal';

// Constants
export const PTY_SERVER_PORT = 3001;

/**
 * Get the WebSocket URL from an HTTPS preview URL
 */
export function httpsToWss(httpsUrl: string): string {
  return httpsUrl.replace(/^https:\/\//, 'wss://');
}
