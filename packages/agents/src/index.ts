/**
 * Coding Agents SDK
 *
 * A TypeScript SDK for interacting with various AI coding agents.
 * Create a sandbox with @daytonaio/sdk and pass it to createSession.
 *
 * @example
 * ```typescript
 * import { Daytona } from "@daytonaio/sdk"
 * import { createSession } from "@background-agents/sdk"
 *
 * const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
 * const sandbox = await daytona.create({ envVars: { ANTHROPIC_API_KEY: '...' } })
 *
 * const session = await createSession("claude", {
 *   sandbox,
 *   systemPrompt: 'You are a helpful assistant.',
 * })
 *
 * // Start a turn
 * await session.start("Hello!")
 *
 * // Poll for events
 * while (true) {
 *   const result = await session.getEvents()
 *   for (const event of result.events) {
 *     if (event.type === "token") process.stdout.write(event.text)
 *   }
 *   if (!result.running) break
 *   await new Promise(r => setTimeout(r, 500))
 * }
 *
 * await sandbox.delete()
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Event,
  SessionEvent,
  TokenEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolEndEvent,
  EndEvent,
  AgentCrashedEvent,
  EventType,
  ToolName,
  WriteToolInput,
  ReadToolInput,
  EditToolInput,
  GlobToolInput,
  GrepToolInput,
  ShellToolInput,
  ToolInputMap,
} from "./types/events"

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AgentDefinition,
  AgentCapabilities,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "./core/agent"

export type { CanonicalToolName } from "./core/tools"

// ─────────────────────────────────────────────────────────────────────────────
// Background Session Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  BackgroundSession,
  BackgroundRunPhase,
  HistoryMessage,
  PollResult,
  TurnHandle,
} from "./background/index"

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  CodeAgentSandbox,
  ExecuteBackgroundOptions,
  AdaptSandboxOptions,
} from "./types/provider"

// ─────────────────────────────────────────────────────────────────────────────
// Session API (Main Entry Point)
// ─────────────────────────────────────────────────────────────────────────────

export {
  createSession,
  getSession,
  getAgentNames,
  type SessionOptions,
  type CreateSessionOptions,
} from "./session"

// ─────────────────────────────────────────────────────────────────────────────
// Agent Registry
// ─────────────────────────────────────────────────────────────────────────────

export { registry, getAgent, agentSupportsPlanMode } from "./core/registry"

// ─────────────────────────────────────────────────────────────────────────────
// Tool Utilities
// ─────────────────────────────────────────────────────────────────────────────

export {
  normalizeToolName,
  createToolStartEvent,
  getToolDisplayName,
  CANONICAL_DISPLAY_NAMES,
} from "./core/tools"

// ─────────────────────────────────────────────────────────────────────────────
// Agent Definitions (for direct import)
// ─────────────────────────────────────────────────────────────────────────────

export {
  claudeAgent,
  codexAgent,
  elizaAgent,
  geminiAgent,
  gooseAgent,
  kiloAgent,
  opencodeAgent,
  piAgent,
} from "./agents/index"

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox Adapter
// ─────────────────────────────────────────────────────────────────────────────

export { adaptDaytonaSandbox, adaptSandbox } from "./sandbox/index"

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export {
  safeJsonParse,
  ensureCliInstalled,
  getPackageName,
  extractErrorMessage,
  classifyAgentError,
  resolveAgentError,
} from "./utils/index"
export type { AgentErrorCategory, ClassifiedError } from "./utils/index"

// Debug (enable with CODING_AGENTS_DEBUG=1)
export { isDebugEnabled, debugLog } from "./debug"
