"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Terminal, FileText, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message } from "@/lib/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex", isUser && "justify-end")}>
      {/* Content */}
      <div className={cn("max-w-[90%]", isUser && "text-right")}>
        {isUser ? (
          <div className="inline-block rounded-lg px-4 py-2 text-sm bg-muted text-foreground">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <AssistantContent message={message} />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Assistant Content (with tool calls)
// =============================================================================

function AssistantContent({ message }: { message: Message }) {
  const hasContent = message.content && message.content.trim().length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const isEmpty = !hasContent && !hasToolCalls

  if (isEmpty) {
    return (
      <div className="text-2xl text-muted-foreground animate-pulse">
        ...
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {/* Tool Calls */}
      {hasToolCalls && (
        <div className="space-y-2">
          {message.toolCalls!.map((tool, index) => (
            <ToolCallItem key={index} tool={tool} />
          ))}
        </div>
      )}

      {/* Text Content */}
      {hasContent && (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-li:leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Tool Call Item
// =============================================================================

interface ToolCallItemProps {
  tool: {
    tool: string
    summary: string
    fullSummary?: string
    output?: string
  }
}

function ToolCallItem({ tool }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)

  const Icon = getToolIcon(tool.tool)
  const hasOutput = !!tool.output

  return (
    <div className="rounded border border-border/50 bg-muted/50 overflow-hidden">
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1 text-xs text-left",
          hasOutput && "hover:bg-accent/50 cursor-pointer"
        )}
      >
        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate font-mono">
          {tool.summary}
        </span>
        {hasOutput && (
          expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )
        )}
      </button>

      {expanded && tool.output && (
        <div className="px-2 py-1 border-t border-border/50 bg-muted/30">
          <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-48">
            {tool.output}
          </pre>
        </div>
      )}
    </div>
  )
}

function getToolIcon(toolName: string) {
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
