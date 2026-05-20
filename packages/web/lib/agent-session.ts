/**
 * Agent Session utilities for Simple Chat
 * Uses shared code from @upstream/common
 */

import {
  createSession,
  getSession,
  type Event,
  type EndEvent,
} from "background-agents"
import {
  buildSystemPrompt,
  buildContentBlocks,
  agentToProvider,
  type Agent,
  type ContentBlock,
  type ToolCall,
  type SkillCatalogEntry,
} from "@upstream/common"
import {
  setupClaudeHooks,
  setupCodexRules,
  OPENCODE_PERMISSION_ENV,
} from "@upstream/agent-configuration/git"
import {
  setupMcpForAgent,
  type AgentMcpServer,
} from "@upstream/agent-configuration/mcp"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"

// Re-export Agent type for convenience
export type { Agent }

/**
 * Best-effort serialization of an unknown thrown value. Avoids the
 * "Unknown error" trap when something non-Error (a plain object, an SDK
 * rejection, a string) bubbles up — at minimum we surface *what* it was.
 */
export function formatAgentError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== "Error" ? `${err.name}: ` : ""
    const cause = (err as { cause?: unknown }).cause
    const causeMsg =
      cause instanceof Error
        ? ` (cause: ${cause.message})`
        : cause != null
        ? ` (cause: ${String(cause)})`
        : ""
    return `${name}${err.message || "Error"}${causeMsg}`
  }
  if (typeof err === "string") return err || "Empty error"
  if (err && typeof err === "object") {
    try {
      const json = JSON.stringify(err)
      if (json && json !== "{}") return json
    } catch {
      /* fall through */
    }
  }
  return String(err)
}

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionOptions {
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
  agent?: Agent
  model?: string
  env?: Record<string, string>
  /** When true, agent should plan before acting */
  planMode?: boolean
  /**
   * Discovered skills to inject as a structured catalog in the system prompt.
   * Populated by scanning .agents/skills/ after install.
   */
  skills?: SkillCatalogEntry[]
  /**
   * MCP servers to expose to the agent. The web layer fetches these from
   * `ChatMcpServer` and decrypts the per-row Smithery API key before passing
   * them in — this module stays generic and doesn't touch the DB.
   */
  mcpServers?: AgentMcpServer[]
}

// =============================================================================
// Background Session
// =============================================================================

export interface BackgroundStartOptions {
  /** Previous conversation history to inject as context (e.g., on agent switch). */
  history?: readonly { role: "user" | "assistant"; content: string }[]
}

export interface BackgroundAgentSession {
  backgroundSessionId: string
  start: (prompt: string, options?: BackgroundStartOptions) => Promise<void>
}

export async function createBackgroundAgentSession(
  sandbox: DaytonaSandbox,
  options: AgentSessionOptions
): Promise<BackgroundAgentSession> {
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern,
    options.skills
  )

  // Map agent type to SDK provider name
  const agent = options.agent || "opencode"
  const provider = agentToProvider[agent] || "opencode"

  // Set up git safety hooks based on agent type
  // This blocks dangerous git operations (push, rebase, reset --hard, etc.)
  if (agent === "claude-code") {
    await setupClaudeHooks(sandbox)
  } else if (agent === "codex") {
    await setupCodexRules(sandbox)
  }

  // Write per-agent MCP config files for the connected MCP servers.
  // Must run before createSession() so the CLI loads them on spawn.
  // Always call — even with an empty list — so that disconnecting the last
  // server overwrites the previous on-disk config in a reused sandbox. Skipping
  // the call here would leave stale entries the agent CLI still loads.
  if (options.mcpServers) {
    try {
      await setupMcpForAgent(sandbox, {
        agent,
        servers: options.mcpServers,
      })
    } catch (err) {
      // MCP setup is best-effort — a failure here shouldn't block the turn.
      console.error("[agent-session] setupMcpForAgent failed:", err)
    }
  }

  // For OpenCode in non-plan mode, inject default permission rules via environment variable
  // (Plan mode permissions are handled by the agent's buildCommand)
  // Debug: log planMode from options
  console.log(`[agent-session] options.planMode=${options.planMode}`)

  const env = { ...options.env }
  if (agent === "opencode" && !options.planMode) {
    env.OPENCODE_PERMISSION = OPENCODE_PERMISSION_ENV
  }

  // Debug: log the full assembled system prompt before sending to the LLM
  console.log("[agent-session] System prompt:\n" + systemPrompt)

  const bgSession = await createSession(provider, {
    sandbox: sandbox as any,
    systemPrompt,
    sessionId: options.sessionId,
    cwd: options.repoPath,
    model: options.model,
    env: Object.keys(env).length > 0 ? env : undefined,
    planMode: options.planMode,
  })

  return {
    backgroundSessionId: bgSession.id,
    async start(prompt: string, options?: BackgroundStartOptions) {
      await bgSession.start(prompt, {
        ...(options?.history?.length && { history: options.history }),
      })
    },
  }
}

// =============================================================================
// Polling
// =============================================================================

/**
 * Cumulative snapshot of an agent session at a point in time.
 * Source of truth: the event log file in the sandbox.
 */
export interface AgentSnapshot {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
  error?: string
  sessionId?: string
}

/**
 * Derive {content, toolCalls, contentBlocks, status, error} from a list of
 * events. Pass cumulative events to get a cumulative summary; pass deltas to
 * get a delta summary.
 */
function summarizeEvents(
  events: Event[],
  running: boolean,
  sessionId: string | null
): AgentSnapshot {
  const { content, toolCalls, contentBlocks } = buildContentBlocks(events)

  const crashEvent = events.find(
    (e) => (e as { type: string }).type === "agent_crashed"
  ) as { type: "agent_crashed"; message?: string; output?: string } | undefined
  if (crashEvent) {
    const baseMsg = crashEvent.message ?? "Process exited without completing"
    // The wrapper captures the agent process's last ~4KB of non-JSON
    // stdout/stderr in `output`. That's where the actual reason (auth
    // failure, missing binary, panic, etc.) lives — surface it.
    const error = crashEvent.output
      ? `${baseMsg}\n\n${crashEvent.output}`
      : baseMsg
    return {
      status: "error",
      content,
      toolCalls,
      contentBlocks,
      error,
      sessionId: sessionId || undefined,
    }
  }

  const endEvent = events.find((e): e is EndEvent => e.type === "end") as
    | (EndEvent & { error?: string })
    | undefined

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

  const isCompleted = !!endEvent

  if (!running && !endEvent) {
    const hasOutput = !!content?.trim() || toolCalls.length > 0
    return {
      status: hasOutput ? "completed" : "error",
      content,
      toolCalls,
      contentBlocks,
      error: hasOutput ? undefined : "Agent stopped without completing",
      sessionId: sessionId || undefined,
    }
  }

  return {
    status: isCompleted ? "completed" : "running",
    content,
    toolCalls,
    contentBlocks,
    sessionId: sessionId || undefined,
  }
}

/**
 * Advance the bg session's per-turn meta after a turn has completed by
 * triggering one getEvents() call. snapshotBackgroundAgent is read-only and
 * doesn't perform this bookkeeping; without it, the next start() in the
 * same session would write to the just-finished turn's outputFile.
 *
 * Best-effort: errors are swallowed because the snapshot has already been
 * persisted to the DB and the wire state has settled.
 */
export async function finalizeTurn(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<void> {
  try {
    const systemPrompt = buildSystemPrompt(
      options.repoPath,
      options.previewUrlPattern,
      options.skills
    )
    const bgSession = await getSession(backgroundSessionId, {
      sandbox: sandbox as any,
      systemPrompt,
    })
    await bgSession.getEvents()
  } catch {
    /* best effort */
  }
}

/**
 * Cancel a running background agent by killing its process.
 * Called when the user clicks "Stop" to terminate the agent.
 */
export async function cancelBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<void> {
  try {
    const systemPrompt = buildSystemPrompt(
      options.repoPath,
      options.previewUrlPattern,
      options.skills
    )

    const bgSession = await getSession(backgroundSessionId, {
      sandbox: sandbox as any,
      systemPrompt,
    })

    await bgSession.cancel()
  } catch (err) {
    console.error("[cancelBackgroundAgent] Error:", err)
    // Don't rethrow - cancellation is best-effort
  }
}

/**
 * Read cumulative state by re-parsing the entire event log on disk in the
 * sandbox. Use on connect, on reconnect, and for any persistence write
 * where you need the full snapshot. Does not advance the session's cursor.
 */
export async function snapshotBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<AgentSnapshot> {
  try {
    const systemPrompt = buildSystemPrompt(
      options.repoPath,
      options.previewUrlPattern,
      options.skills
    )

    const bgSession = await getSession(backgroundSessionId, {
      sandbox: sandbox as any,
      systemPrompt,
    })

    const result = (await bgSession.getSnapshot()) as {
      events: Event[]
      sessionId: string | null
      cursor: string
      running?: boolean
    }

    const running =
      typeof result.running === "boolean"
        ? result.running
        : await bgSession.isRunning()

    return summarizeEvents(result.events, running, result.sessionId)
  } catch (err) {
    console.error("[snapshotBackgroundAgent] Error:", err)
    return {
      status: "error",
      content: "",
      toolCalls: [],
      contentBlocks: [],
      error: formatAgentError(err),
    }
  }
}
