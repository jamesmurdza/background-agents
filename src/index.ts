/**
 * Code Agent SDK
 *
 * A TypeScript SDK for interacting with various AI coding agents.
 *
 * @example
 * ```typescript
 * import { createProvider } from "code-agent-sdk"
 *
 * const claude = createProvider("claude")
 *
 * // Stream events
 * for await (const event of claude.run()) {
 *   if (event.type === "token") {
 *     process.stdout.write(event.text)
 *   }
 * }
 *
 * // Or use callback style
 * await claude.runWithCallback((event) => {
 *   console.log(event)
 * })
 *
 * // Or collect all text
 * const response = await claude.collectText()
 * ```
 */

// Types
export type {
  Event,
  SessionEvent,
  TokenEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolEndEvent,
  EndEvent,
  EventType,
  ProviderName,
  ProviderCommand,
  RunOptions,
  EventHandler,
  IProvider,
} from "./types/index.js"

// Providers
export {
  Provider,
  ClaudeProvider,
  CodexProvider,
  OpenCodeProvider,
  GeminiProvider,
} from "./providers/index.js"

// Factory
export {
  createProvider,
  getProviderNames,
  isValidProvider,
} from "./factory.js"

// Utilities
export {
  safeJsonParse,
  loadSession,
  storeSession,
  clearSession,
  getDefaultSessionPath,
} from "./utils/index.js"
