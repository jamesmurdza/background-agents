/**
 * Coding Agents SDK
 *
 * A TypeScript SDK for interacting with various AI coding agents.
 * Create a sandbox with @daytonaio/sdk and pass it to createSession.
 *
 * @example
 * ```typescript
 * import { Daytona } from "@daytonaio/sdk"
 * import { createSession } from "@jamesmurdza/coding-agents-sdk"
 *
 * const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
 * const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })
 * const session = await createSession("claude", { sandbox, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } })
 *
 * for await (const event of session.run("Hello")) {
 *   if (event.type === "token") process.stdout.write(event.text)
 * }
 *
 * await sandbox.delete()
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
  ToolName,
  WriteToolInput,
  ReadToolInput,
  EditToolInput,
  GlobToolInput,
  GrepToolInput,
  ShellToolInput,
  ToolInputMap,
  ProviderName,
  ProviderCommand,
  RunOptions,
  RunDefaults,
  ProviderOptions,
  EventHandler,
  IProvider,
  CodeAgentSandbox,
  AdaptSandboxOptions,
} from "./types/index.js"

// Sandbox adapter (wrap a Daytona sandbox from @daytonaio/sdk)
export { adaptDaytonaSandbox } from "./sandbox/index.js"

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

// Session (provider with run defaults; recommended entry points)
export {
  createSession,
  type SessionOptions,
  createBackgroundSession,
  type BackgroundSessionOptions,
  type BackgroundSession,
} from "./session.js"

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
