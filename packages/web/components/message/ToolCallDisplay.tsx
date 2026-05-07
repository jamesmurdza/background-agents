"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Terminal, FileText, Search, LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContentBlock, ToolCall } from "@/lib/types"

// =============================================================================
// Tool Call Display Components
// =============================================================================

/** Get the appropriate icon for a tool */
export function getToolIcon(toolName: string): LucideIcon {
  switch (toolName) {
    case "Bash":
      return Terminal
    case "Read":
    case "Edit":
    case "Write":
      return FileText
    case "Glob":
    case "Grep":
      return Search
    default:
      return Terminal
  }
}

/** Merge consecutive tool_calls blocks into single groups */
export function mergeConsecutiveToolCalls(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []
  let currentToolCalls: ToolCall[] = []

  for (const block of blocks) {
    if (block.type === "tool_calls") {
      // Accumulate tool calls
      currentToolCalls.push(...block.toolCalls)
    } else {
      // Flush accumulated tool calls before adding text
      if (currentToolCalls.length > 0) {
        result.push({ type: "tool_calls", toolCalls: currentToolCalls })
        currentToolCalls = []
      }
      result.push(block)
    }
  }

  // Flush any remaining tool calls
  if (currentToolCalls.length > 0) {
    result.push({ type: "tool_calls", toolCalls: currentToolCalls })
  }

  return result
}

/** Split a tool summary like "Write: hello.html" into a prefix + clickable
 *  detail. Falls back to linking the whole summary when there's no colon. */
export function splitToolSummary(summary: string): { prefix: string; linkText: string } {
  const idx = summary.indexOf(": ")
  if (idx < 0) return { prefix: "", linkText: summary }
  return { prefix: summary.slice(0, idx + 2), linkText: summary.slice(idx + 2) }
}

// =============================================================================
// Tool Call Group (shows all tool calls together in unified block)
// =============================================================================

export interface ToolCallGroupProps {
  toolCalls: ToolCall[]
  onOpenFile?: (filePath: string) => void
  isMobile?: boolean
}

export function ToolCallGroup({ toolCalls, isMobile = false, onOpenFile }: ToolCallGroupProps) {
  if (toolCalls.length === 0) return null

  return (
    <div>
      {toolCalls.map((tool, index) => (
        <ToolCallRow
          key={`${tool.tool}-${tool.summary}-${index}`}
          tool={tool}
          isMobile={isMobile}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

// =============================================================================
// Individual tool call row within the group
// =============================================================================

export interface ToolCallRowProps {
  tool: ToolCall
  isMobile?: boolean
  onOpenFile?: (filePath: string) => void
}

export function ToolCallRow({ tool, isMobile = false, onOpenFile }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(tool.tool)
  const hasOutput = !!tool.output
  const hasFileLink = !!(tool.filePath && onOpenFile)

  const handleRowClick = () => {
    if (hasFileLink) return // filename has its own click handler
    if (hasOutput) setExpanded(!expanded)
  }

  // Summaries from the agent typically look like "Write: hello.html" — when
  // we have a file link, only the part after the tool prefix should be the
  // clickable link, not the entire row text.
  const { prefix, linkText } = splitToolSummary(tool.summary)

  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tool.filePath && onOpenFile) onOpenFile(tool.filePath)
  }

  return (
    <div
      onClick={handleRowClick}
      className={cn(
        isMobile ? "py-1" : "py-0.5",
        hasOutput && !hasFileLink && "cursor-pointer"
      )}
    >
      {/* Tool call header */}
      <div className={cn(
        "flex items-center gap-1.5 text-muted-foreground transition-colors",
        isMobile ? "text-sm" : "text-[13px]",
        hasOutput && !hasFileLink && "hover:text-foreground"
      )}>
        <Icon className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
        <span className="truncate">
          {hasFileLink ? (
            <>
              {prefix}
              <span
                onClick={openFile}
                className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-foreground"
              >
                {linkText}
              </span>
            </>
          ) : (
            tool.summary
          )}
        </span>
        {hasOutput && !hasFileLink && (
          expanded ? (
            <ChevronDown className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          ) : (
            <ChevronRight className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          )
        )}
      </div>

      {/* Tool output - block quote style with left border */}
      {expanded && tool.output && (
        <pre className={cn(
          "font-mono whitespace-pre-wrap overflow-x-auto max-w-full mobile-scroll text-muted-foreground mt-1.5 pl-3 border-l-2 border-border",
          isMobile ? "text-xs max-h-64 ml-5" : "text-[11px] max-h-48 ml-4"
        )}>
          {tool.output}
        </pre>
      )}
    </div>
  )
}
