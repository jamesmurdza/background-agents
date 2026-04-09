/**
 * Agent Session Module
 *
 * Wrapper module for agents SDK providing:
 * - System prompt building (via @upstream/common)
 * - Tool name mapping (via @upstream/common)
 * - Event transformation (via @upstream/common)
 * - Content blocks reconstruction (via @upstream/common)
 * - Session persistence
 * - Streaming and background session management
 */

import {
  createSession,
  getSession,
  type Event,
  type SessionEvent,
  type TokenEvent,
  type ToolStartEvent,
  type ToolEndEvent,
  type EndEvent,
  type BackgroundRunPhase,
} from "@upstream/agents"
import {
  buildSystemPrompt,
  buildContentBlocks as commonBuildContentBlocks,
  mapToolName,
  getProviderForAgent,
  PATHS,
  type Agent,
  type ContentBlock,
  type ToolCall,
} from "@upstream/common"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { updateSnapshot, getAccumulatedEvents } from "@/lib/agents/agent-events"

// Re-export shared utilities for backward compatibility
export { buildSystemPrompt, mapToolName }
export type { ContentBlock, ToolCall }

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionOptions {
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
  model?: string
  env?: Record<string, string>
  agent?: Agent
}

export interface BackgroundAgentOptions extends AgentSessionOptions {
  prompt: string
  // Optional: existing background session ID to reuse
  backgroundSessionId?: string
}

export interface AgentEvent {
  type: "token" | "tool" | "session" | "error" | "done"
  content?: string
  toolCall?: { tool: string; summary: string; fullSummary?: string }
  sessionId?: string
  message?: string
}

export interface AgentCrashedPayload {
  message?: string
  output?: string
}

export interface BackgroundPollResult {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
  error?: string
  agentCrashed?: AgentCrashedPayload
  sessionId?: string
}

// =============================================================================
// Content Blocks Builder (wrapper for web-specific needs)
// =============================================================================

/**
 * Build content blocks from events.
 * This is a thin wrapper around @upstream/common's buildContentBlocks
 * that maintains backward compatibility with web's API.
 */
export function buildContentBlocks(
  events: Event[]
): { content: string; toolCalls: ToolCall[]; contentBlocks: ContentBlock[] } {
  return commonBuildContentBlocks(events)
}

// =============================================================================
// Session Persistence
// =============================================================================

export async function persistSessionId(
  sandbox: DaytonaSandbox,
  sessionId: string
): Promise<void> {
  await sandbox.process.executeCommand(
    `echo '${sessionId}' > ${PATHS.AGENT_SESSION_FILE}`
  )
}

export async function readPersistedSessionId(
  sandbox: DaytonaSandbox
): Promise<string | undefined> {
  try {
    const result = await sandbox.process.executeCommand(
      `cat ${PATHS.AGENT_SESSION_FILE} 2>/dev/null`
    )
    if (!result.exitCode && result.result.trim()) {
      return result.result.trim()
    }
  } catch {
    // No stored session
  }
  return undefined
}

// =============================================================================
// Background Session Execution
// =============================================================================

/** Options for starting a background session run. */
export interface BackgroundStartOptions {
  /** Run-level env vars (override session-level for this run only, cleared after run completes). */
  env?: Record<string, string>
}

/** Background session handle returned by createBackgroundAgentSession. */
export interface BackgroundAgentSession {
  backgroundSessionId: string
  /** Fire-and-forget: launch the agent process in the sandbox. */
  start: (prompt: string, options?: BackgroundStartOptions) => Promise<void>
}

/**
 * Create (or reattach to) a background session. This is fast — no sandbox
 * commands are executed. Call session.start(prompt) separately to actually
 * launch the agent process (that's the slow part).
 */
export async function createBackgroundAgentSession(
  sandbox: DaytonaSandbox,
  options: Omit<BackgroundAgentOptions, "prompt">
): Promise<BackgroundAgentSession> {
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern
  )

  // Map agent type to SDK provider name (handles legacy "claude" values)
  const agent = options.agent || "claude-code"
  const provider = getProviderForAgent(agent)

  // Pass undefined for model if "default" to let SDK choose
  const modelToUse = options.model === "default" ? undefined : options.model

  // If we have an existing background session ID, reuse it via getSession.
  // Otherwise, create a new session.
  // Note: sandbox cast needed due to different @daytonaio/sdk versions in monorepo
  const t0 = Date.now()
  const bgSession = options.backgroundSessionId
    ? await getSession(options.backgroundSessionId, {
        sandbox: sandbox as any,
        systemPrompt,
        model: modelToUse,
        env: options.env,
        cwd: options.repoPath,
      })
    : await createSession(provider, {
        sandbox: sandbox as any,
        systemPrompt,
        model: modelToUse,
        sessionId: options.sessionId,
        env: options.env,
        cwd: options.repoPath,
      })
  console.log(`[createBackgroundAgentSession] ${options.backgroundSessionId ? "get" : "create"} took ${Date.now() - t0}ms`)

  return {
    backgroundSessionId: bgSession.id,
    async start(prompt: string, startOptions?: BackgroundStartOptions) {
      const t1 = Date.now()
      // Pass run-level env if provided (overrides session-level for this run only)
      if (startOptions?.env) {
        await bgSession.start(prompt, { env: startOptions.env })
      } else {
        await bgSession.start(prompt)
      }
      console.log(`[createBackgroundAgentSession] bgSession.start took ${Date.now() - t1}ms`)
    },
  }
}

export interface PollBackgroundOptions {
  repoPath: string
  previewUrlPattern?: string
  model?: string
  agent?: Agent
  /** AgentExecution.id – each poll writes latest snapshot to DB for status API. */
  agentExecutionId: string
}

export async function pollBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: PollBackgroundOptions
): Promise<BackgroundPollResult> {
  try {
    const systemPrompt = buildSystemPrompt(
      options.repoPath,
      options.previewUrlPattern
    )

    // Pass undefined for model if "default" to let SDK choose
    const modelToUse = options.model === "default" ? undefined : options.model

    // getSession only needs sandbox for polling (no env needed)
    // Note: sandbox cast needed due to different @daytonaio/sdk versions in monorepo
    const bgSession = await getSession(backgroundSessionId, {
      sandbox: sandbox as any,
      systemPrompt,
      model: modelToUse,
    })

    const eventsResult = await bgSession.getEvents() as {
      events: Event[]
      sessionId: string | null
      cursor: string
      running?: boolean
      runPhase?: BackgroundRunPhase
    }
    const { events: newEvents, sessionId } = eventsResult
    let running: boolean
    if (typeof eventsResult.running === "boolean") {
      running = eventsResult.running
    } else {
      // Compatibility path for older SDK shape without running in getEvents().
      running = await bgSession.isRunning()
    }
    const runPhase: BackgroundRunPhase =
      eventsResult.runPhase ?? (running ? "running" : "stopped")

    // Accumulate events in DB so all clients share the same stream.
    const cached = await getAccumulatedEvents(options.agentExecutionId)
    const allEvents: Event[] = [...(cached as Event[]), ...newEvents]

    const { content, toolCalls, contentBlocks } = buildContentBlocks(allEvents)

    // Persist snapshot + accumulated events to DB.
    try {
      await updateSnapshot(options.agentExecutionId, {
        latestSnapshot: { content, toolCalls, contentBlocks },
        accumulatedEvents: allEvents,
      })
    } catch (error) {
      console.error(
        "[agent-session] failed to update snapshot",
        { agentExecutionId: options.agentExecutionId },
        error,
      )
    }

    // Persist session ID if received
    if (sessionId) {
      await persistSessionId(sandbox, sessionId)
    }

    // agent_crashed = process exited without completing (crash/kill); has message?, output?
    const crashEvent = allEvents.find(
      (e) => (e as { type: string }).type === "agent_crashed"
    ) as { type: "agent_crashed"; message?: string; output?: string } | undefined
    if (crashEvent) {
      return {
        status: "error",
        content,
        toolCalls,
        contentBlocks,
        error: crashEvent.message ?? "Process exited without completing",
        agentCrashed: {
          message: crashEvent.message,
          output: crashEvent.output,
        },
        sessionId: sessionId || undefined,
      }
    }

    // Prefer explicit "end" event for completion.
    // When running is false and there is no end event, treat as stopped so we don't poll forever.
    const endEvent = allEvents.find((e): e is EndEvent => e.type === "end") as
      | (EndEvent & { error?: string })
      | undefined
    const hasEndEvent = !!endEvent
    const isCompleted = hasEndEvent

    if (endEvent?.error) {
      return {
        status: "error",
        content,
        toolCalls,
        contentBlocks,
        error: endEvent.error,
        sessionId: sessionId || undefined,
      }
    }

    // No active turn in meta yet (e.g. before start or between turns) — keep polling.
    if (runPhase === "idle" && !hasEndEvent) {
      return {
        status: "running",
        content,
        toolCalls,
        contentBlocks,
        sessionId: sessionId || undefined,
      }
    }

    if (!running && !hasEndEvent) {
      // Process exited without an explicit "end" event. If we have meaningful
      // content or tool calls, the agent likely finished its work — treat as
      // completed rather than errored (some agents, e.g. OpenCode, don't emit
      // an end event). Only flag as error when the process stopped with nothing.
      const hasOutput = !!(content?.trim()) || toolCalls.length > 0
      return {
        status: hasOutput ? "completed" : "error",
        content,
        toolCalls,
        contentBlocks,
        error: hasOutput ? undefined : "Agent stopped without completing (process ended without end event)",
        sessionId: sessionId || undefined,
      }
    }

    return {
      status: isCompleted ? "completed" : "running",
      content,
      toolCalls,
      contentBlocks,
      error: undefined,
      sessionId: sessionId || undefined,
    }
  } catch (err) {
    // Sandbox/SDK error (e.g. disconnect, process gone) – return error with whatever we have from DB.
    const msg = err instanceof Error ? err.message : "Unknown error polling background session"
    let content = ""
    let toolCalls: ToolCall[] = []
    let contentBlocks: ContentBlock[] = []
    try {
      const cached = await getAccumulatedEvents(options.agentExecutionId)
      const rebuilt = buildContentBlocks(cached as Event[])
      content = rebuilt.content
      toolCalls = rebuilt.toolCalls
      contentBlocks = rebuilt.contentBlocks
    } catch {
      // DB also failed – return empty content
    }

    return {
      status: "error",
      content,
      toolCalls,
      contentBlocks,
      error: msg,
    }
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { Event, SessionEvent, TokenEvent, ToolStartEvent, ToolEndEvent, EndEvent }
export type { Agent }
