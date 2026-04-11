"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Terminal, FileText, Search, GitMerge, LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, ContentBlock, ToolCall } from "@/lib/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  isMobile?: boolean
}

export function MessageBubble({ message, isStreaming, isMobile = false }: MessageBubbleProps) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex", isUser && "justify-end")}>
      {/* Content */}
      <div className={cn(
        isUser && "text-right",
        isMobile ? "max-w-[95%]" : "max-w-[90%]"
      )}>
        {isUser ? (
          <div className={cn(
            "inline-block rounded-lg bg-muted text-foreground",
            isMobile ? "px-3 py-2 text-base" : "px-4 py-2 text-sm"
          )}>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <AssistantContent message={message} isStreaming={isStreaming} isMobile={isMobile} />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Assistant Content (with tool calls)
// =============================================================================

function MarkdownContent({ text, isMobile = false }: { text: string; isMobile?: boolean }) {
  return (
    <div className={cn(
      "prose dark:prose-invert max-w-none",
      "prose-p:leading-relaxed prose-p:my-2",
      "prose-li:leading-relaxed prose-li:my-0.5",
      "prose-ul:my-2 prose-ol:my-2",
      "prose-headings:mt-4 prose-headings:mb-2",
      "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
      isMobile ? "prose-base" : "prose-sm"
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="break-words">
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p className="my-2">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 pl-4 list-disc">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 pl-4 list-decimal">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="my-0.5">{children}</li>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 -mx-2 px-2">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/50 px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          pre: ({ children }) => (
            <pre className={cn(
              "overflow-x-auto",
              isMobile && "-mx-2 px-2 rounded-lg"
            )}>
              {children}
            </pre>
          ),
          code: ({ children, className, ...props }) => {
            const isInline = !className
            return (
              <code
                {...props}
                className={cn(
                  className,
                  isInline && "break-words"
                )}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function AssistantContent({ message, isStreaming, isMobile = false }: { message: Message; isStreaming?: boolean; isMobile?: boolean }) {
  const hasContent = message.content && message.content.trim().length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0
  const isEmpty = !hasContent && !hasToolCalls && !hasBlocks
  const isGitOperation = message.messageType === "git-operation"

  if (isEmpty) {
    return (
      <div className="text-2xl text-muted-foreground animate-pulse">
        ...
      </div>
    )
  }

  // Git operation messages use InfoBubble with colored variant
  if (isGitOperation) {
    // For errors, extract summary and details
    let summary = message.content
    let details: string | undefined

    if (message.isError) {
      const colonIndex = message.content.indexOf(": ")
      if (colonIndex !== -1) {
        summary = message.content.slice(0, colonIndex)
        details = message.content.slice(colonIndex + 2).trim()
      }
    }

    return (
      <InfoBubble
        icon={GitMerge}
        summary={summary}
        output={details}
        variant={message.isError ? "error" : "success"}
        isMobile={isMobile}
      />
    )
  }

  return (
    <div className={cn(
      "leading-relaxed",
      isMobile ? "space-y-4 text-base" : "space-y-3 text-sm"
    )}>
      {hasBlocks ? (
        // Render content blocks in order (text and tool calls interleaved)
        message.contentBlocks!.map((block, index) => {
          if (block.type === "text" && block.text.trim()) {
            return <MarkdownContent key={index} text={block.text} isMobile={isMobile} />
          }
          if (block.type === "tool_calls") {
            return (
              <ToolCallAccordion
                key={index}
                toolCalls={block.toolCalls}
                isMobile={isMobile}
              />
            )
          }
          return null
        })
      ) : (
        // Fallback: render content then tool calls (for messages without contentBlocks)
        <>
          {hasContent && <MarkdownContent text={message.content} isMobile={isMobile} />}
          {hasToolCalls && (
            <ToolCallAccordion
              toolCalls={message.toolCalls!}
              isMobile={isMobile}
            />
          )}
        </>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="text-2xl text-muted-foreground animate-pulse">
          ...
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Shared Info Bubble (used for tool calls and git operations)
// =============================================================================

interface InfoBubbleProps {
  icon: LucideIcon
  summary: string
  output?: string
  variant?: "default" | "success" | "error"
  isMobile?: boolean
}

function InfoBubble({ icon: Icon, summary, output, variant = "default", isMobile = false }: InfoBubbleProps) {
  const [expanded, setExpanded] = useState(false)
  const hasOutput = !!output

  const containerClasses = cn(
    "rounded overflow-hidden",
    variant === "error" && "bg-red-500/10 dark:bg-red-500/5",
    variant === "success" && "bg-green-500/10 dark:bg-green-500/5",
    variant === "default" && "bg-muted/30"
  )

  const iconClasses = cn(
    "shrink-0",
    variant === "error" && "text-red-500 dark:text-red-400",
    variant === "success" && "text-green-600 dark:text-green-400",
    variant === "default" && "text-muted-foreground",
    isMobile ? "h-4 w-4" : "h-3 w-3"
  )

  return (
    <div className={containerClasses}>
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 text-left text-muted-foreground transition-colors",
          // Padding is the same regardless of hasOutput, and touch-target is
          // only for mobile tap accessibility — applying it conditionally on
          // hasOutput made rows with output visibly taller than rows without.
          isMobile ? "px-3 py-2.5 text-sm touch-target" : "px-2.5 py-1.5 text-xs",
          hasOutput && "hover:text-foreground cursor-pointer"
        )}
      >
        <Icon className={iconClasses} />
        <span className="truncate">
          {summary}
        </span>
        {hasOutput && (
          expanded ? (
            <ChevronDown className={cn(
              "shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          ) : (
            <ChevronRight className={cn(
              "shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          )
        )}
      </button>

      {expanded && output && (
        <div className={cn(
          "border-t border-border/50 bg-muted/30",
          isMobile ? "px-3 py-2" : "px-2 py-1"
        )}>
          <pre className={cn(
            "font-mono whitespace-pre-wrap overflow-x-auto mobile-scroll",
            isMobile ? "text-sm max-h-64" : "text-xs max-h-48"
          )}>
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

function getToolIcon(toolName: string): LucideIcon {
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

// =============================================================================
// Tool Call Accordion (groups consecutive tool calls)
// =============================================================================

interface ToolCallAccordionProps {
  toolCalls: ToolCall[]
  isMobile?: boolean
}

function ToolCallAccordion({ toolCalls, isMobile = false }: ToolCallAccordionProps) {
  const [expanded, setExpanded] = useState(false)

  if (toolCalls.length === 0) return null

  // Single tool call - render directly without accordion wrapper
  if (toolCalls.length === 1) {
    const tool = toolCalls[0]
    return (
      <InfoBubble
        icon={getToolIcon(tool.tool)}
        summary={tool.summary}
        output={tool.output}
        isMobile={isMobile}
      />
    )
  }

  // Multiple tool calls - show accordion
  const firstTool = toolCalls[0]
  const remainingCount = toolCalls.length - 1

  return (
    <div className="flex flex-col gap-1">
      {/* First tool call always visible */}
      <InfoBubble
        icon={getToolIcon(firstTool.tool)}
        summary={firstTool.summary}
        output={firstTool.output}
        isMobile={isMobile}
      />

      {/* Toggle button for remaining */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors",
          isMobile ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"
        )}
      >
        {expanded ? (
          <ChevronDown className={cn(isMobile ? "h-3 w-3" : "h-2.5 w-2.5")} />
        ) : (
          <ChevronRight className={cn(isMobile ? "h-3 w-3" : "h-2.5 w-2.5")} />
        )}
        <span>{remainingCount} more tool {remainingCount === 1 ? "call" : "calls"}</span>
      </button>

      {/* Expanded tool calls */}
      {expanded && (
        <div className="flex flex-col gap-1">
          {toolCalls.slice(1).map((tool, index) => (
            <InfoBubble
              key={index}
              icon={getToolIcon(tool.tool)}
              summary={tool.summary}
              output={tool.output}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
