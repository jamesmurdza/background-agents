/**
 * Agent Session utilities for Simple Chat
 * Simplified version of the web app's agent-session.ts
 */

import {
  createSession,
  getSession,
  type Event,
  type TokenEvent,
  type ToolStartEvent,
  type ToolEndEvent,
  type EndEvent,
} from "@upstream/agents"
import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { PATHS, SANDBOX_CONFIG } from "./constants"
import type { ContentBlock } from "./types"

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionOptions {
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
}

// =============================================================================
// Tool Name Mapping
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

## Logs Directory
- Write any log files to ${PATHS.LOGS_DIR}.
- Examples: ${PATHS.LOGS_DIR}/build.log, ${PATHS.LOGS_DIR}/test-results.log

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
// Tool Detail Extraction
// =============================================================================

interface ToolDetailResult {
  summary: string
  fullDetail?: string
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
// Content Blocks Builder
// =============================================================================

const TOOL_OUTPUT_MAX_CHARS = 4000

export function buildContentBlocks(
  events: Event[]
): {
  content: string
  toolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }>
  contentBlocks: ContentBlock[]
} {
  const blocks: ContentBlock[] = []
  let pendingText = ""
  let pendingToolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }> = []
  const allToolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }> = []
  let allContent = ""

  for (const event of events) {
    if (event.type === "token") {
      const tokenEvent = event as TokenEvent
      if (pendingToolCalls.length > 0) {
        blocks.push({ type: "tool_calls", toolCalls: [...pendingToolCalls] })
        pendingToolCalls = []
      }
      pendingText += tokenEvent.text
      allContent += tokenEvent.text
    } else if (event.type === "tool_start") {
      const toolEvent = event as ToolStartEvent
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
    } else if (event.type === "tool_end") {
      const toolEndEvent = event as ToolEndEvent
      const rawOutput = toolEndEvent.output
      if (rawOutput && rawOutput.trim() && allToolCalls.length > 0) {
        let output = rawOutput.trim()
        if (output.length > TOOL_OUTPUT_MAX_CHARS) {
          output = output.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n... (output truncated)"
        }
        allToolCalls[allToolCalls.length - 1].output = output
      }
    }
  }

  // Flush remaining
  if (pendingToolCalls.length > 0) {
    blocks.push({ type: "tool_calls", toolCalls: [...pendingToolCalls] })
  }
  if (pendingText) {
    blocks.push({ type: "text", text: pendingText })
  }

  if (allContent && !allContent.endsWith("\n")) {
    allContent += "\n"
  }

  return { content: allContent, toolCalls: allToolCalls, contentBlocks: blocks }
}

// =============================================================================
// Background Session
// =============================================================================

export interface BackgroundAgentSession {
  backgroundSessionId: string
  start: (prompt: string) => Promise<void>
}

export async function createBackgroundAgentSession(
  sandbox: DaytonaSandbox,
  options: AgentSessionOptions
): Promise<BackgroundAgentSession> {
  const systemPrompt = buildSystemPrompt(
    options.repoPath,
    options.previewUrlPattern
  )

  const bgSession = await createSession("claude-code", {
    sandbox: sandbox as any,
    systemPrompt,
    sessionId: options.sessionId,
    cwd: options.repoPath,
  })

  return {
    backgroundSessionId: bgSession.id,
    async start(prompt: string) {
      await bgSession.start(prompt)
    },
  }
}

export interface PollResult {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }>
  contentBlocks: ContentBlock[]
  error?: string
  sessionId?: string
}

export async function pollBackgroundAgent(
  sandbox: DaytonaSandbox,
  backgroundSessionId: string,
  options: AgentSessionOptions
): Promise<PollResult> {
  try {
    const systemPrompt = buildSystemPrompt(
      options.repoPath,
      options.previewUrlPattern
    )

    const bgSession = await getSession(backgroundSessionId, {
      sandbox: sandbox as any,
      systemPrompt,
    })

    const eventsResult = await bgSession.getEvents() as {
      events: Event[]
      sessionId: string | null
      cursor: string
      running?: boolean
    }

    const { events, sessionId } = eventsResult
    let running: boolean
    if (typeof eventsResult.running === "boolean") {
      running = eventsResult.running
    } else {
      running = await bgSession.isRunning()
    }

    const { content, toolCalls, contentBlocks } = buildContentBlocks(events)

    // Check for crash
    const crashEvent = events.find(
      (e) => (e as { type: string }).type === "agent_crashed"
    ) as { type: "agent_crashed"; message?: string } | undefined
    if (crashEvent) {
      return {
        status: "error",
        content,
        toolCalls,
        contentBlocks,
        error: crashEvent.message ?? "Process exited without completing",
        sessionId: sessionId || undefined,
      }
    }

    // Check for end event
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
      const hasOutput = !!(content?.trim()) || toolCalls.length > 0
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    return {
      status: "error",
      content: "",
      toolCalls: [],
      contentBlocks: [],
      error: msg,
    }
  }
}
