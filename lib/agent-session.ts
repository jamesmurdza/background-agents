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
import { updateSnapshot } from "@/lib/agent-events"

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

export interface BackgroundPollResult {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{ tool: string; summary: string }>
  contentBlocks: ContentBlock[]
  error?: string
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

export async function startBackgroundAgent(
  sandbox: DaytonaSandbox,
  options: BackgroundAgentOptions
): Promise<{ executionId: string; backgroundSessionId: string }> {
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

  const result = await bgSession.start(options.prompt)

  // The background session ID serves as the execution ID
  return {
    executionId: result.executionId,
    backgroundSessionId: bgSession.id,
  }
}

// In-memory cache for accumulated events per background session.
// This is safe because pollBackgroundAgent is now only called from the
// single-process agent poller (not per-request polling), so we don't rely on
// this map for cross-instance state.
const backgroundSessionEvents = new Map<string, Event[]>()

// Last snapshot payload per execution; skip DB append when unchanged (e.g. agent thinking).
const lastSnapshotByExecutionId = new Map<string, string>()

export function clearLastSnapshotForExecution(agentExecutionId: string): void {
  lastSnapshotByExecutionId.delete(agentExecutionId)
}

export interface PollBackgroundOptions {
  repoPath: string
  previewUrlPattern?: string
  model?: string
  env?: Record<string, string>
  agent?: Agent
  /**
   * Optional AgentExecution.id; when provided, each poll writes latest snapshot
   * to execution.latestSnapshot for status API.
   */
  agentExecutionId?: string
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

    // Accumulate events for this background session so we can build streaming
    // content from the full history, not just the latest batch.
    const cachedEvents = backgroundSessionEvents.get(backgroundSessionId) || []
    const allEvents = [...cachedEvents, ...newEvents]
    backgroundSessionEvents.set(backgroundSessionId, allEvents)

    const { content, toolCalls, contentBlocks } = buildContentBlocks(allEvents)

    // Persist snapshot to execution row only when it changed (reduces writes while agent is idle).
    if (options.agentExecutionId) {
      const payload = { content, toolCalls, contentBlocks }
      const key = JSON.stringify(payload)
      if (lastSnapshotByExecutionId.get(options.agentExecutionId) !== key) {
        lastSnapshotByExecutionId.set(options.agentExecutionId, key)
        try {
          await updateSnapshot(options.agentExecutionId, payload)
        } catch (error) {
          console.error(
            "[agent-session] failed to update snapshot",
            { agentExecutionId: options.agentExecutionId },
            error,
          )
        }
      }
    }

    // Persist session ID if received
    if (sessionId) {
      await persistSessionId(sandbox, sessionId)
    }

    // Stop if any of these is true: process exited, or we have an 'end' event, or step_finish(reason=stop)
    const hasEndEvent = allEvents.some(e => e.type === "end")
    const hasStopFinish = allEvents.some(
      (e) =>
        (e as { type?: string; part?: { reason?: string } }).type === "step_finish" &&
        (e as { part?: { reason?: string } }).part?.reason === "stop"
    )
    const isCompleted = !isRunning || hasEndEvent || hasStopFinish

    return {
      status: isCompleted ? "completed" : "running",
      content,
      toolCalls,
      contentBlocks,
      error: undefined,
      sessionId: sessionId || undefined,
    }
  } catch (err) {
    // Sandbox/SDK error (e.g. disconnect, process gone) – return error so poller persists and shows in chat.
    const msg = err instanceof Error ? err.message : "Unknown error polling background session"
    const cachedEvents = backgroundSessionEvents.get(backgroundSessionId) || []
    const { content, toolCalls, contentBlocks } = buildContentBlocks(cachedEvents)

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
