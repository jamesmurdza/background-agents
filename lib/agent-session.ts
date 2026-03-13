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

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionOptions {
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
  model?: string
  env?: Record<string, string>
}

export interface BackgroundAgentOptions extends AgentSessionOptions {
  prompt: string
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
    const exampleUrl = previewUrlPattern.replace("{port}", "3000")
    prompt += `

If you start a server or service on any port, provide the user with the preview URL.
The preview URL pattern is: ${previewUrlPattern}
Replace {port} with the actual port number. For example, if you start a server on port 3000, the URL is: ${exampleUrl}`
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

const SESSION_FILE_PATH = "/home/daytona/.agent_session_id"

export async function persistSessionId(
  sandbox: DaytonaSandbox,
  sessionId: string
): Promise<void> {
  await sandbox.process.executeCommand(
    `echo '${sessionId}' > ${SESSION_FILE_PATH}`
  )
}

export async function readPersistedSessionId(
  sandbox: DaytonaSandbox
): Promise<string | undefined> {
  try {
    const result = await sandbox.process.executeCommand(
      `cat ${SESSION_FILE_PATH} 2>/dev/null`
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
    model: options.model,
    sessionId: options.sessionId,
    env: options.env,
  }

  const session = await sdkCreateSession("claude", sessionOptions)

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
  const bgSessionOptions: BackgroundSessionOptions = {
    sandbox: sandbox as unknown as BackgroundSessionOptions['sandbox'],
    systemPrompt,
    model: options.model,
    sessionId: options.sessionId,
    env: options.env,
  }

  const bgSession = await sdkCreateBackgroundSession("claude", bgSessionOptions)

  const result = await bgSession.start(options.prompt)

  // The background session ID serves as the execution ID
  return {
    executionId: result.executionId,
    backgroundSessionId: bgSession.id,
  }
}

export async function pollBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string
): Promise<BackgroundPollResult> {
  try {
    // Cast sandbox for SDK version compatibility
    const bgSession = await sdkGetBackgroundSession({
      sandbox: sandbox as unknown as NonNullable<BackgroundSessionOptions['sandbox']>,
      backgroundSessionId,
    })

    const isRunning = await bgSession.isRunning()
    const { events, sessionId } = await bgSession.getEvents()

    // Build content, tool calls, and content blocks from events
    const { content, toolCalls, contentBlocks } = buildContentBlocks(events)

    // Persist session ID if received
    if (sessionId) {
      await persistSessionId(sandbox, sessionId)
    }

    // Check for error event
    let error: string | undefined
    // Note: SDK doesn't emit error events currently, but we handle it for future compatibility

    return {
      status: isRunning ? "running" : "completed",
      content,
      toolCalls,
      contentBlocks,
      error,
      sessionId: sessionId || undefined,
    }
  } catch (err) {
    return {
      status: "error",
      content: "",
      toolCalls: [],
      contentBlocks: [],
      error: err instanceof Error ? err.message : "Unknown error polling background session",
    }
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { Event, SessionEvent, TokenEvent, ToolStartEvent, ToolEndEvent, EndEvent }
