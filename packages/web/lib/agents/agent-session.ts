/**
 * Agent Session Module
 *
 * Wrapper module for agents SDK providing:
 * - System prompt building
 * - Tool name mapping (SDK names to UI names)
 * - Event transformation
 * - Content blocks reconstruction
 * - Session persistence
 * - Streaming and background session management
 */

import {
  createBackgroundSession as sdkCreateBackgroundSession,
  getBackgroundSession as sdkGetBackgroundSession,
  type Event,
  type SessionEvent,
  type TokenEvent,
  type ToolStartEvent,
  type ToolEndEvent,
  type EndEvent,
  type BackgroundSessionOptions,
} from "@upstream/agents"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { type Agent, getProviderForAgent } from "@/lib/shared/types"
import { PATHS, SANDBOX_CONFIG } from "@/lib/shared/constants"
import { updateSnapshot, getAccumulatedEvents } from "@/lib/agents/agent-events"

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

// JSON-serializable content block type for Prisma
export type ContentBlock = {
  type: "text"
  text: string
} | {
  type: "tool_calls"
  toolCalls: Array<{ tool: string; summary: string; fullSummary?: string }>
}

export interface AgentCrashedPayload {
  message?: string
  output?: string
}

export interface BackgroundPollResult {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{ tool: string; summary: string; fullSummary?: string }>
  contentBlocks: ContentBlock[]
  error?: string
  agentCrashed?: AgentCrashedPayload
  sessionId?: string
}

// =============================================================================
// Tool Name Mapping (SDK uses lowercase, UI expects PascalCase)
// =============================================================================

const TOOL_NAME_MAP: Record<string, string> = {
  shell: "Bash",
  bash: "Bash",
  write: "Write",
  read: "Read",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
}

export function mapToolName(sdkTool: string): string {
  return TOOL_NAME_MAP[sdkTool.toLowerCase()] || sdkTool
}

// =============================================================================
// System Prompt Builder
// =============================================================================

export function buildSystemPrompt(
  repoPath: string,
  previewUrlPattern?: string
): string {
  // NOTE: The lines about --amend are specifically for Claude Code, which has a tendency to
  // use git commit --amend. We don't want this because we only fast-forward push, so amending
  // would cause the push to fail (non-fast-forward error).
  let prompt = `You are an AI coding agent running in a Daytona sandbox.
The repository is cloned at ${repoPath}.

## Git Rules
- You are working on the git branch that is currently checked out. Do not create, switch, or delete branches.
- You must commit all file changes before finishing your task.
- Commit frequently: create a commit after completing each logical unit of work.
- Always create NEW commits. Never rewrite git history (no git commit --amend, git rebase, or git reset --hard).
- Do not push — pushing is handled automatically.
- Use "git restore" to discard file changes (not "git checkout").

## File Operations
- Use ${repoPath} for all file operations.
- Always check the current state of files before editing them.

## Running Web Servers
- Always start web servers using nohup to ensure they run in the background and persist.
- Example: nohup npm start > server.log 2>&1 &

## When Finished
- Provide a clear summary of what you did.`

  if (previewUrlPattern) {
    const defaultPort = String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
    const exampleUrl = previewUrlPattern.replace("{port}", defaultPort)
    prompt += `

If you start a server or service on any port, provide the user with the preview URL.
The preview URL pattern is: ${previewUrlPattern}
Replace {port} with the actual port number. For example, if you start a server on port ${defaultPort}, the URL is: ${exampleUrl}`
  }

  return prompt
}

// =============================================================================
// Tool Detail Extraction (for summary strings)
// =============================================================================

interface ToolDetailResult {
  summary: string
  fullDetail?: string // Only set if different from summary (i.e., was truncated)
}

function getToolDetail(toolName: string, input: unknown): ToolDetailResult {
  if (!input || typeof input !== "object") return { summary: "" }
  const inp = input as Record<string, unknown>

  const mappedName = mapToolName(toolName)

  if (mappedName === "Bash" && inp.command) {
    const cmd = String(inp.command)
    if (cmd.length > 80) {
      return { summary: cmd.slice(0, 80) + "...", fullDetail: cmd }
    }
    return { summary: cmd }
  }
  if (["Read", "Edit", "Write"].includes(mappedName) && inp.file_path) {
    const path = String(inp.file_path)
    const filename = path.split("/").pop() || path
    // Only set fullDetail if filename is different from full path
    if (filename !== path) {
      return { summary: filename, fullDetail: path }
    }
    return { summary: filename }
  }
  if (mappedName === "Glob" && inp.pattern) {
    return { summary: String(inp.pattern) }
  }
  if (mappedName === "Grep" && inp.pattern) {
    return { summary: String(inp.pattern) }
  }

  return { summary: "" }
}

// =============================================================================
// ContentBlocks Builder (for background execution results)
// =============================================================================

export function buildContentBlocks(
  events: Event[]
): { content: string; toolCalls: Array<{ tool: string; summary: string; fullSummary?: string }>; contentBlocks: ContentBlock[] } {
  const blocks: ContentBlock[] = []
  let pendingText = ""
  let pendingToolCalls: Array<{ tool: string; summary: string; fullSummary?: string }> = []
  const allToolCalls: Array<{ tool: string; summary: string; fullSummary?: string }> = []
  let allContent = ""

  for (const event of events) {
    if (event.type === "token") {
      const tokenEvent = event as TokenEvent
      // Flush pending tool calls before adding text
      if (pendingToolCalls.length > 0) {
        blocks.push({ type: "tool_calls", toolCalls: [...pendingToolCalls] })
        pendingToolCalls = []
      }
      pendingText += tokenEvent.text
      allContent += tokenEvent.text
    } else if (event.type === "tool_start") {
      const toolEvent = event as ToolStartEvent
      // Flush pending text before adding tool call
      if (pendingText) {
        blocks.push({ type: "text", text: pendingText })
        pendingText = ""
      }
      const tool = mapToolName(toolEvent.name)
      const { summary: detail, fullDetail } = getToolDetail(toolEvent.name, toolEvent.input)
      const summary = detail ? `${tool}: ${detail}` : tool
      const fullSummary = fullDetail ? `${tool}: ${fullDetail}` : undefined
      const toolCall = { tool, summary, fullSummary }
      pendingToolCalls.push(toolCall)
      allToolCalls.push(toolCall)
    }
  }

  // Flush remaining
  if (pendingToolCalls.length > 0) {
    blocks.push({ type: "tool_calls", toolCalls: [...pendingToolCalls] })
  }
  if (pendingText) {
    blocks.push({ type: "text", text: pendingText })
  }

  // Ensure content ends with newline (matching Python behavior)
  if (allContent && !allContent.endsWith("\n")) {
    allContent += "\n"
  }

  return { content: allContent, toolCalls: allToolCalls, contentBlocks: blocks }
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

  // Cast sandbox for SDK version compatibility
  const sandboxForSdk = sandbox as unknown as NonNullable<BackgroundSessionOptions['sandbox']>

  // Map agent type to SDK provider name (handles legacy "claude" values)
  const agent = options.agent || "claude-code"
  const provider = getProviderForAgent(agent)

  // Pass undefined for model if "default" to let SDK choose
  const modelToUse = options.model === "default" ? undefined : options.model

  // If we have an existing background session ID, reuse it via getBackgroundSession.
  // Otherwise, create a new background session.
  const t0 = Date.now()
  const bgSession = options.backgroundSessionId
    ? await sdkGetBackgroundSession({
        sandbox: sandboxForSdk,
        backgroundSessionId: options.backgroundSessionId,
        systemPrompt,
        model: modelToUse,
        env: options.env,
      })
    : await sdkCreateBackgroundSession(provider, {
        sandbox: sandboxForSdk,
        systemPrompt,
        model: modelToUse,
        sessionId: options.sessionId,
        env: options.env,
        // Note: skipInstall removed to allow CLI installation (Codex, etc.)
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

    // Cast sandbox for SDK version compatibility
    // getBackgroundSession only needs sandbox + backgroundSessionId for polling (no env needed)

    const bgSession = await sdkGetBackgroundSession({
      sandbox: sandbox as unknown as NonNullable<BackgroundSessionOptions['sandbox']>,
      backgroundSessionId,
      systemPrompt,
      model: modelToUse,
    })

    const eventsResult = await bgSession.getEvents() as {
      events: Event[]
      sessionId: string | null
      cursor: string
      running?: boolean
    }
    const { events: newEvents, sessionId } = eventsResult
    let running: boolean
    if (typeof eventsResult.running === "boolean") {
      running = eventsResult.running
    } else {
      // Compatibility path for older SDK shape without running in getEvents().
      running = await bgSession.isRunning()
    }

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

    if (!running && !hasEndEvent) {
      return {
        status: "error",
        content,
        toolCalls,
        contentBlocks,
        error: "Agent stopped without completing (process ended without end event)",
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
    let toolCalls: Array<{ tool: string; summary: string }> = []
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
