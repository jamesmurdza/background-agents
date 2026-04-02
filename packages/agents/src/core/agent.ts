/**
 * Core Agent Definition Interface
 *
 * This is the minimal interface for implementing a new agent.
 * No inheritance required - just implement this interface.
 */

import type { Event } from "../types/events.js"
import type { CodeAgentSandbox } from "../types/provider.js"

/**
 * Command specification returned by buildCommand()
 */
export interface CommandSpec {
  /** The CLI command to run */
  cmd: string
  /** Arguments to pass to the command */
  args: string[]
  /** Environment variables for this command */
  env?: Record<string, string>
  /** If true, wrap in bash for stderr handling */
  wrapInBash?: boolean
}

/**
 * Context passed to parse() for stateful parsing
 */
export interface ParseContext {
  /** Mutable state for stateful parsing (e.g., Gemini tool buffer) */
  state: Record<string, unknown>
  /** Current session ID if known */
  sessionId: string | null
}

/**
 * Run options passed to buildCommand()
 */
export interface RunOptions {
  prompt?: string
  model?: string
  sessionId?: string
  timeout?: number
  systemPrompt?: string
  env?: Record<string, string>
}

/**
 * Agent capabilities - optional features an agent supports
 */
export interface AgentCapabilities {
  /** Agent supports native system prompt (vs synthetic prefix) */
  supportsSystemPrompt?: boolean
  /** Agent supports session resumption */
  supportsResume?: boolean
  /** Agent requires special setup (e.g., login) */
  setup?: (sandbox: CodeAgentSandbox, env: Record<string, string>) => Promise<void>
}

/**
 * The core agent definition interface.
 *
 * Implement this interface to add a new agent. No inheritance required.
 *
 * @example
 * ```typescript
 * export const myAgent: AgentDefinition = {
 *   name: 'my-agent',
 *   toolMappings: { my_tool: 'shell' },
 *   buildCommand(options) {
 *     return { cmd: 'my-agent', args: ['--json', options.prompt ?? ''] }
 *   },
 *   parse(line, context) {
 *     const json = JSON.parse(line)
 *     if (json.type === 'text') return { type: 'token', text: json.content }
 *     return null
 *   },
 * }
 * ```
 */
export interface AgentDefinition {
  /** Unique agent identifier */
  readonly name: string

  /** Tool name mappings (provider-specific -> canonical) */
  readonly toolMappings: Record<string, string>

  /** Optional agent capabilities */
  readonly capabilities?: AgentCapabilities

  /**
   * Build the CLI command to run the agent
   */
  buildCommand(options: RunOptions): CommandSpec

  /**
   * Parse a line of output into event(s)
   * @returns Event, array of events, or null if line should be ignored
   */
  parse(line: string, context: ParseContext): Event | Event[] | null
}
