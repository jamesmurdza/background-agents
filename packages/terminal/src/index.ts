/**
 * @upstream/terminal
 *
 * WebSocket-based PTY terminal for Daytona sandboxes.
 *
 * This package provides:
 * - A React component (xterm.js) for rendering the terminal in the browser
 * - Sandbox setup functions to install and run the PTY server
 * - The PTY server code itself (for custom deployments)
 *
 * Quick Start:
 * ```typescript
 * import { Daytona } from "@daytonaio/sdk"
 * import { setupTerminal, WebSocketTerminal } from "@upstream/terminal"
 *
 * const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
 * const sandbox = await daytona.create()
 * const { websocketUrl } = await setupTerminal(sandbox)
 *
 * // In React:
 * <WebSocketTerminal websocketUrl={websocketUrl} />
 * ```
 */

// React components
export { WebSocketTerminal } from './components/WebSocketTerminal'
export type { WebSocketTerminalProps } from './components/WebSocketTerminal'

// Sandbox setup (requires @daytonaio/sdk)
export {
  setupTerminal,
  stopTerminal,
  getTerminalStatus,
} from './sandbox'
export type {
  TerminalSetupResult,
  TerminalSetupOptions,
} from './sandbox'

// Server code (for custom deployments)
export {
  getPtyServerCode,
  getPtyServerPackageJson,
  PTY_SERVER_PORT,
} from './server'

/**
 * Convert an HTTPS URL to a WebSocket URL
 */
export function httpsToWss(httpsUrl: string): string {
  return httpsUrl.replace(/^https:\/\//, 'wss://')
}
