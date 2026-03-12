/**
 * Code Agent SDK
 *
 * A TypeScript SDK for interacting with various AI coding agents.
 * All providers run in a secure Daytona sandbox by default.
 *
 * @example
 * ```typescript
 * import { createSandbox, createProvider } from "code-agent-sdk"
 *
 * // Create a sandbox
 * const sandbox = createSandbox({ apiKey: process.env.DAYTONA_API_KEY })
 * await sandbox.create()
 *
 * // Create a provider with the sandbox
 * const provider = createProvider("claude", { sandbox })
 *
 * // Run the provider
 * for await (const event of provider.run({ prompt: "Hello" })) {
 *   if (event.type === "token") {
 *     process.stdout.write(event.text)
 *   }
 * }
 *
 * // Cleanup
 * await sandbox.destroy()
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
  ProviderOptions,
  EventHandler,
  IProvider,
  SandboxConfig,
} from "./types/index.js"

// Sandbox
export {
  SandboxManager,
  createSandbox,
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
