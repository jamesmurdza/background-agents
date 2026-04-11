"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Terminal, FileText, Search, GitMerge, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, ContentBlock } from "@/lib/types"
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
      "prose dark:prose-invert max-w-none prose-p:leading-relaxed prose-li:leading-relaxed",
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

  // Git operation messages get special styling (like tool calls but different color)
  if (isGitOperation) {
    return <GitOperationBubble content={message.content} isError={message.isError} isMobile={isMobile} />
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
              <div key={index} className="space-y-2">
                {block.toolCalls.map((tool, toolIndex) => (
                  <ToolCallItem key={toolIndex} tool={tool} isMobile={isMobile} />
                ))}
              </div>
            )
          }
          return null
        })
      ) : (
        // Fallback: render content then tool calls (for messages without contentBlocks)
        <>
          {hasContent && <MarkdownContent text={message.content} isMobile={isMobile} />}
          {hasToolCalls && (
            <div className="space-y-2">
              {message.toolCalls!.map((tool, index) => (
                <ToolCallItem key={index} tool={tool} isMobile={isMobile} />
              ))}
            </div>
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
// Git Operation Bubble (styled like tool calls but with different background)
// =============================================================================

function GitOperationBubble({ content, isError = false, isMobile = false }: { content: string; isError?: boolean; isMobile?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  // For errors, extract the summary (before the colon) and details (after the colon)
  let summary = content
  let details = ""

  if (isError) {
    // Match pattern like "**Merge failed:** error details"
    const match = content.match(/^(\*\*[^*]+\*\*:?)\s*(.*)$/s)
    if (match) {
      summary = match[1]
      details = match[2].trim()
    }
  }

  const hasDetails = isError && details.length > 0
  const Icon = isError ? AlertCircle : GitMerge

  return (
    <div className={cn(
      "rounded border overflow-hidden",
      isError
        ? "border-red-500/30 bg-red-500/10 dark:bg-red-500/5"
        : "border-green-500/30 bg-green-500/10 dark:bg-green-500/5"
    )}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full text-left",
          isMobile ? "px-3 py-2.5 text-sm" : "px-2 py-1 text-xs",
          hasDetails && "hover:bg-accent/50 active:bg-accent cursor-pointer touch-target"
        )}
      >
        <Icon className={cn(
          "shrink-0",
          isError ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400",
          isMobile ? "h-4 w-4" : "h-3 w-3"
        )} />
        <span className="flex-1 truncate">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <span>{children}</span>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              a: ({ children, ...props }) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "underline",
                    isError ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                  )}
                >
                  {children}
                </a>
              ),
            }}
          >
            {hasDetails ? summary : content}
          </ReactMarkdown>
        </span>
        {hasDetails && (
          expanded ? (
            <ChevronDown className={cn(
              "text-muted-foreground shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          ) : (
            <ChevronRight className={cn(
              "text-muted-foreground shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          )
        )}
      </button>

      {expanded && hasDetails && (
        <div className={cn(
          "border-t border-border/50 bg-muted/30",
          isMobile ? "px-3 py-2" : "px-2 py-1"
        )}>
          <pre className={cn(
            "font-mono whitespace-pre-wrap overflow-x-auto mobile-scroll",
            isMobile ? "text-sm max-h-64" : "text-xs max-h-48"
          )}>
            {details}
          </pre>
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
  isMobile?: boolean
}

function ToolCallItem({ tool, isMobile = false }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false)

  const Icon = getToolIcon(tool.tool)
  const hasOutput = !!tool.output

  return (
    <div className="rounded border border-border/50 bg-muted/50 overflow-hidden">
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full text-left",
          isMobile ? "px-3 py-2.5 text-sm" : "px-2 py-1 text-xs",
          hasOutput && "hover:bg-accent/50 active:bg-accent cursor-pointer touch-target"
        )}
      >
        <Icon className={cn(
          "text-muted-foreground shrink-0",
          isMobile ? "h-4 w-4" : "h-3 w-3"
        )} />
        <span className="flex-1 truncate font-mono">
          {tool.summary}
        </span>
        {hasOutput && (
          expanded ? (
            <ChevronDown className={cn(
              "text-muted-foreground shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          ) : (
            <ChevronRight className={cn(
              "text-muted-foreground shrink-0",
              isMobile ? "h-4 w-4" : "h-3 w-3"
            )} />
          )
        )}
      </button>

      {expanded && tool.output && (
        <div className={cn(
          "border-t border-border/50 bg-muted/30",
          isMobile ? "px-3 py-2" : "px-2 py-1"
        )}>
          <pre className={cn(
            "font-mono whitespace-pre-wrap overflow-x-auto mobile-scroll",
            isMobile ? "text-sm max-h-64" : "text-xs max-h-48"
          )}>
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
