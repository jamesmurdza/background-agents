/**
 * Session API (Background-Only)
 *
 * This is the main public API for the agents SDK.
 * All sessions are background sessions - no synchronous mode.
 */

import { randomUUID } from "node:crypto"
import { debugLog } from "./debug.js"

// Import and register all agents
import "./agents/index.js"

import { getAgent, getAgentNames } from "./core/registry.js"
import {
  createBackgroundSession as createBgSession,
  writeInitialSessionMeta,
  readProviderFromMeta,
  type BackgroundSession,
} from "./background/index.js"
import { adaptSandbox } from "./sandbox/index.js"
import type { CodeAgentSandbox, ProviderName } from "./types/provider.js"

const CODEAGENT_SESSION_DIR_PREFIX = "/tmp/codeagent-"

/** Cache reattached sessions by id so repeated polls don't recreate the session. */
const sessionCache = new Map<string, BackgroundSession>()

/**
 * Session options for creating or getting a session.
 */
export interface SessionOptions {
  /** Sandbox instance (Daytona or compatible) */
  sandbox: CodeAgentSandbox | import("@daytonaio/sdk").Sandbox
  /** Model to use (agent-specific) */
  model?: string
  /** Session ID for resumption */
  sessionId?: string
  /** Timeout in minutes */
  timeout?: number
  /** System prompt to prepend */
  systemPrompt?: string
  /** Environment variables */
  env?: Record<string, string>
}

/**
 * Options for createSession (includes optional background session ID for reattachment)
 */
export interface CreateSessionOptions extends SessionOptions {
  /** Existing background session ID to reattach to */
  backgroundSessionId?: string
}

/**
 * Create a new session with an agent.
 *
 * This is the main entry point for the SDK.
 * All sessions are background sessions that use start() and getEvents().
 *
 * @example
 * ```typescript
 * const session = await createSession('claude', {
 *   sandbox,
 *   env: { ANTHROPIC_API_KEY: '...' },
 *   systemPrompt: 'You are a helpful assistant.',
 * })
 *
 * await session.start('Hello!')
 * const result = await session.getEvents()
 * console.log(result.events)
 * ```
 */
export async function createSession(
  agentName: string,
  options: CreateSessionOptions
): Promise<BackgroundSession> {
  const { backgroundSessionId, ...sessionOptions } = options
  const id = backgroundSessionId ?? randomUUID()

  debugLog("createSession", options.sessionId, agentName, "id=" + id)

  return createSessionWithId(agentName, sessionOptions, id)
}

/**
 * Reattach to an existing session by background session ID.
 *
 * The agent type is read from the session metadata stored in the sandbox.
 *
 * @example
 * ```typescript
 * const session = await getSession('abc-123', { sandbox })
 * const result = await session.getEvents()
 * ```
 */
export async function getSession(
  backgroundSessionId: string,
  options: Omit<SessionOptions, "sessionId">
): Promise<BackgroundSession> {
  // Check cache first
  const cached = sessionCache.get(backgroundSessionId)
  if (cached) {
    debugLog("getSession", null, "id=" + backgroundSessionId, "cached")
    return cached
  }

  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${backgroundSessionId}`
  const sandbox = adaptSandbox(options.sandbox)

  debugLog("getSession", undefined, "id=" + backgroundSessionId, "sessionDir=" + sessionDir)

  const meta = await readProviderFromMeta(sandbox, sessionDir)
  if (!meta?.provider) {
    debugLog("getSession meta missing or no provider", meta?.sessionId ?? undefined, backgroundSessionId)
    throw new Error(
      "Cannot get session: meta not found (start a turn first) or meta has no provider"
    )
  }

  debugLog("getSession reattach provider=" + meta.provider, meta.sessionId)

  return createSessionWithId(
    meta.provider,
    {
      ...options,
      sessionId: meta.sessionId ?? undefined,
    },
    backgroundSessionId,
    { skipWriteInitialMeta: true }
  )
}

/**
 * Get all available agent names.
 */
export { getAgentNames }

// ─────────────────────────────────────────────────────────────────────────────
// Internal implementation
// ─────────────────────────────────────────────────────────────────────────────

async function createSessionWithId(
  agentName: string,
  options: SessionOptions,
  id: string,
  opts?: { skipWriteInitialMeta?: boolean }
): Promise<BackgroundSession> {
  const agent = getAgent(agentName)
  const sandbox = adaptSandbox(options.sandbox)
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${id}`

  // Run agent installation (cast to ProviderName for backwards compat with sandbox interface)
  await sandbox.ensureProvider(agentName as ProviderName)

  // Apply session-level env vars
  if (options.env) {
    if (sandbox.setSessionEnvVars) {
      sandbox.setSessionEnvVars(options.env)
    } else {
      sandbox.setEnvVars(options.env)
    }
  }

  // Run agent-specific setup (e.g., Codex login)
  if (agent.capabilities?.setup) {
    await agent.capabilities.setup(sandbox, options.env ?? {})
  }

  // Create the background session
  const session = createBgSession(agent, sandbox, sessionDir, {
    model: options.model,
    sessionId: options.sessionId,
    timeout: options.timeout,
    systemPrompt: options.systemPrompt,
    env: options.env,
  })

  // Write initial meta for reattachment
  if (!opts?.skipWriteInitialMeta) {
    await writeInitialSessionMeta(
      sandbox,
      sessionDir,
      agent.name,
      options.sessionId ?? null
    )
  }

  // Cache the session
  sessionCache.set(id, session)

  return session
}

// Re-export types
export type { BackgroundSession } from "./background/index.js"
export type { BackgroundRunPhase, PollResult, TurnHandle } from "./background/types.js"
