"use client"

import { useState } from "react"
import { User, Bot, ChevronDown, ChevronRight, Terminal, FileText, Search } from "lucide-react"
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
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 max-w-[85%]", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-lg px-4 py-2 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <AssistantContent message={message} />
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Assistant Content (with tool calls)
// =============================================================================

function AssistantContent({ message }: { message: Message }) {
  return (
    <div className="space-y-2">
      {/* Tool Calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-1">
          {message.toolCalls.map((tool, index) => (
            <ToolCallItem key={index} tool={tool} />
          ))}
        </div>
      )}

      {/* Text Content */}
      {message.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
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
    <div className="rounded border border-border/50 bg-background/50 overflow-hidden">
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
