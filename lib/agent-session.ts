/**
 * Agent Session Module
 *
 * Wrapper module for @jamesmurdza/coding-agents-sdk providing:
 * - System prompt building
 * - Tool name mapping (SDK names to UI names)
 * - Event transformation
 * - Content blocks reconstruction
 * - Session persistence
 * - Streaming and background session management
 */

import {
  createSession as sdkCreateSession,
  createBackgroundSession as sdkCreateBackgroundSession,
  getBackgroundSession as sdkGetBackgroundSession,
  type Event,
  type SessionEvent,
  type TokenEvent,
  type ToolStartEvent,
  type ToolEndEvent,
  type EndEvent,
  type SessionOptions,
  type BackgroundSessionOptions,
} from "@jamesmurdza/coding-agents-sdk"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { type Agent, getProviderForAgent } from "@/lib/types"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { updateSnapshot, getAccumulatedEvents } from "@/lib/agent-events"

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
  toolCall?: { tool: string; summary: string }
  sessionId?: string
  message?: string
}

// JSON-serializable content block type for Prisma
export type ContentBlock = {
  type: "text"
  text: string
} | {
  type: "tool_calls"
  toolCalls: Array<{ tool: string; summary: string }>
}

export interface AgentCrashedPayload {
  message?: string
  output?: string
}

export interface BackgroundPollResult {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{ tool: string; summary: string }>
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
  let prompt = `You are an AI coding agent running in a Daytona sandbox.
The repository is cloned at ${repoPath}.
You are working on the git branch that is currently checked out.
Use this directory for all file operations.
Always check the current state of files before editing them.
After making meaningful changes, commit them with a descriptive message using git add and git commit.
Do not push — pushing is handled automatically.
When you finish a task, provide a clear summary of what you did.`

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

function getToolDetail(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const inp = input as Record<string, unknown>

  const mappedName = mapToolName(toolName)

  if (mappedName === "Bash" && inp.command) {
    const cmd = String(inp.command)
    return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd
  }
  if (["Read", "Edit", "Write"].includes(mappedName) && inp.file_path) {
    const path = String(inp.file_path)
    return path.split("/").pop() || path
  }
  if (mappedName === "Glob" && inp.pattern) {
    return String(inp.pattern)
  }
  if (mappedName === "Grep" && inp.pattern) {
    return String(inp.pattern)
  }

  return ""
}

// =============================================================================
// Event Transformation
// =============================================================================

export function transformEvent(event: Event): AgentEvent | null {
  switch (event.type) {
    case "token":
      return { type: "token", content: (event as TokenEvent).text }

    case "tool_start": {
      const toolEvent = event as ToolStartEvent
      const tool = mapToolName(toolEvent.name)
      const detail = getToolDetail(toolEvent.name, toolEvent.input)
      const summary = detail ? `${tool}: ${detail}` : tool
      return {
        type: "tool",
        toolCall: { tool, summary },
      }
    }

    case "session":
      return { type: "session", sessionId: (event as SessionEvent).id }

    case "end":
      return { type: "done" }

    case "tool_delta":
    case "tool_end":
      // These events are for tool output streaming, not needed for UI
      return null

    default:
      return null
  }
}

// =============================================================================
// ContentBlocks Builder (for background execution results)
// =============================================================================

export function buildContentBlocks(
  events: Event[]
): { content: string; toolCalls: Array<{ tool: string; summary: string }>; contentBlocks: ContentBlock[] } {
  const blocks: ContentBlock[] = []
  let pendingText = ""
  let pendingToolCalls: Array<{ tool: string; summary: string }> = []
  const allToolCalls: Array<{ tool: string; summary: string }> = []
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
      const detail = getToolDetail(toolEvent.name, toolEvent.input)
      const summary = detail ? `${tool}: ${detail}` : tool
      const toolCall = { tool, summary }
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
// Streaming Session Creation and Execution
// =============================================================================

export async function createAgentSession(
  sandbox: DaytonaSandbox,
  options: AgentSessionOptions
) {
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern
  )

  // Note: We cast sandbox to 'unknown' then to SessionOptions['sandbox'] to handle
  // version mismatch between @daytonaio/sdk in main project vs SDK's dependency.
  // The runtime interface is compatible.
  const sessionOptions: SessionOptions = {
    sandbox: sandbox as unknown as SessionOptions['sandbox'],
    systemPrompt,
    // Pass undefined for model if "default" to let SDK choose
    model: options.model === "default" ? undefined : options.model,
    sessionId: options.sessionId,
    env: options.env,
  }

  // Map agent type to SDK provider name (handles legacy "claude" values)
  const agent = options.agent || "claude-code"
  const provider = getProviderForAgent(agent)

  const session = await sdkCreateSession(provider, sessionOptions)

  return { session, sandbox }
}

export async function* runAgentQuery(
  session: Awaited<ReturnType<typeof sdkCreateSession>>,
  sandbox: DaytonaSandbox,
  prompt: string
): AsyncGenerator<AgentEvent> {
  for await (const event of session.run(prompt)) {
    const transformed = transformEvent(event)
    if (transformed) {
      // Persist session ID when received
      if (transformed.type === "session" && transformed.sessionId) {
        await persistSessionId(sandbox, transformed.sessionId)
      }
      yield transformed
    }
  }
}

// =============================================================================
// Background Session Execution
// =============================================================================

/** Background session handle returned by createBackgroundAgentSession. */
export interface BackgroundAgentSession {
  backgroundSessionId: string
  /** Fire-and-forget: launch the agent process in the sandbox. */
  start: (prompt: string) => Promise<void>
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
        skipInstall: true, // TEMP: bypass install
      })
  console.log(`[createBackgroundAgentSession] ${options.backgroundSessionId ? "get" : "create"} took ${Date.now() - t0}ms`)

  return {
    backgroundSessionId: bgSession.id,
    async start(prompt: string) {
      const t1 = Date.now()
      await bgSession.start(prompt)
      console.log(`[createBackgroundAgentSession] bgSession.start took ${Date.now() - t1}ms`)
    },
  }
}

export interface PollBackgroundOptions {
  repoPath: string
  previewUrlPattern?: string
  model?: string
  env?: Record<string, string>
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
    // Must pass full session options when reattaching - SDK recreates the provider

    const bgSession = await sdkGetBackgroundSession({
      sandbox: sandbox as unknown as NonNullable<BackgroundSessionOptions['sandbox']>,
      backgroundSessionId,
      systemPrompt,
      model: modelToUse,
      env: options.env,
    })

    const isRunning = await bgSession.isRunning()
    const { events: newEvents, sessionId } = await bgSession.getEvents()

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

    // Completed = process not running or we saw an event with type === "end" (SDK turns step_finish/reason=stop into end)
    const hasEndEvent = allEvents.some(e => e.type === "end")
    const isCompleted = !isRunning || hasEndEvent

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
