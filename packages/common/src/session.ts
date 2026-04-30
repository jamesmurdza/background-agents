/**
 * Agent session utilities
 * Shared between web and simple-chat packages
 */

import type {
  Event,
  TokenEvent,
  ToolStartEvent,
  ToolEndEvent,
} from "background-agents"
import type { ContentBlock, ToolCall } from "./types"
import { PATHS, SANDBOX_CONFIG } from "./constants"

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

function mapToolName(sdkTool: string): string {
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
- Provide a clear summary of what you did.

## User Slash Commands
The user has access to the following slash commands in the chat interface:
- /merge - Merge branches
- /rebase - Rebase onto another branch
- /pr - Create a pull request

If the user asks to merge, rebase, create a PR, or do similar branch operations, kindly remind them to use the appropriate slash command instead. Do not perform these operations yourself.`

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
  fullDetail?: string
  filePath?: string
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
      return { summary: filename, fullDetail: path, filePath: path }
    }
    return { summary: filename, filePath: path }
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

/** Maximum characters to store/display for a single multi-line tool output. */
const TOOL_OUTPUT_MAX_CHARS = 4000

export interface BuildContentBlocksResult {
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
}

export function buildContentBlocks(events: Event[]): BuildContentBlocksResult {
  const blocks: ContentBlock[] = []
  let pendingText = ""
  let pendingToolCalls: ToolCall[] = []
  const allToolCalls: ToolCall[] = []
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
      const { summary: detail, fullDetail, filePath } = getToolDetail(
        toolEvent.name,
        toolEvent.input
      )
      const summary = detail ? `${tool}: ${detail}` : tool
      const fullSummary = fullDetail ? `${tool}: ${fullDetail}` : undefined
      const toolCall: ToolCall = { tool, summary, fullSummary, filePath }
      pendingToolCalls.push(toolCall)
      allToolCalls.push(toolCall)
    } else if (event.type === "tool_end") {
      const toolEndEvent = event as ToolEndEvent
      const rawOutput = toolEndEvent.output
      // Attach output to the last tool call if one exists and output is non-empty
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

  // Ensure content ends with newline
  if (allContent && !allContent.endsWith("\n")) {
    allContent += "\n"
  }

  return { content: allContent, toolCalls: allToolCalls, contentBlocks: blocks }
}
