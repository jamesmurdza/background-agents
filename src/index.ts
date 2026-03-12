/**
 * Code Agent SDK
 *
 * A TypeScript SDK for interacting with various AI coding agents.
 * By default, all providers run in a secure Daytona sandbox.
 *
 * @example
 * ```typescript
 * import { createProvider } from "code-agent-sdk"
 *
 * const claude = createProvider("claude")
 *
 * // Run in sandbox (default - secure)
 * for await (const event of claude.run({ prompt: "Hello" })) {
 *   if (event.type === "token") {
 *     process.stdout.write(event.text)
 *   }
 * }
 *
 * // Run locally (opt-in - use with caution)
 * for await (const event of claude.run({ prompt: "Hello", mode: "local" })) {
 *   // ...
 * }
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
  ExecutionMode,
  SandboxConfig,
} from "./types/index.js"

// Sandbox
export {
  SandboxManager,
  createSandbox,
  type SessionCommandOptions,
} from "./sandbox/index.js"

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
  isCliInstalled,
  installProvider,
  ensureCliInstalled,
  getPackageName,
  getInstallationStatus,
} from "./utils/index.js"
