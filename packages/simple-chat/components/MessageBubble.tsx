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

  // Git operation messages use SystemMessage component
  if (isGitOperation) {
    return (
      <SystemMessage
        icon={GitMerge}
        content={message.content}
        variant={message.isError ? "error" : "success"}
        isMobile={isMobile}
      />
    )
  }

  // Merge consecutive tool_calls blocks into single groups
  const mergedBlocks = hasBlocks ? mergeConsecutiveToolCalls(message.contentBlocks!) : null

  return (
    <div className={cn(
      "leading-relaxed",
      isMobile ? "space-y-4 text-base" : "space-y-3 text-sm"
    )}>
      {mergedBlocks ? (
        // Render merged content blocks
        mergedBlocks.map((block, index) => {
          if (block.type === "text" && block.text.trim()) {
            return <MarkdownContent key={index} text={block.text} isMobile={isMobile} />
          }
          if (block.type === "tool_calls") {
            return (
              <ToolCallGroup
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
            <ToolCallGroup
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
// System Message (for git operations and other system messages)
// =============================================================================

interface SystemMessageProps {
  icon: LucideIcon
  content: string
  variant?: "success" | "error"
  isMobile?: boolean
}

function SystemMessage({ icon: Icon, content, variant = "success", isMobile = false }: SystemMessageProps) {
  const iconClasses = cn(
    "shrink-0",
    variant === "error" && "text-red-500 dark:text-red-400",
    variant === "success" && "text-green-600 dark:text-green-400",
    isMobile ? "h-4 w-4" : "h-3.5 w-3.5"
  )

  return (
    <div className={cn(
      "flex items-start gap-2",
      isMobile ? "text-base" : "text-sm"
    )}>
      <Icon className={cn(iconClasses, "mt-0.5")} />
      <span className="text-foreground">{content}</span>
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
// Helper: Merge consecutive tool_calls blocks
// =============================================================================

function mergeConsecutiveToolCalls(blocks: ContentBlock[]): ContentBlock[] {
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

// =============================================================================
// Tool Call Group (shows all tool calls together in unified block)
// =============================================================================

interface ToolCallGroupProps {
  toolCalls: ToolCall[]
  isMobile?: boolean
}

function ToolCallGroup({ toolCalls, isMobile = false }: ToolCallGroupProps) {
  if (toolCalls.length === 0) return null

  return (
    <div className="rounded overflow-hidden bg-muted/30">
      {toolCalls.map((tool, index) => (
        <ToolCallRow
          key={index}
          tool={tool}
          isMobile={isMobile}
          isLast={index === toolCalls.length - 1}
        />
      ))}
    </div>
  )
}

// Individual tool call row within the accordion
interface ToolCallRowProps {
  tool: ToolCall
  isMobile?: boolean
  isLast?: boolean
}

function ToolCallRow({ tool, isMobile = false, isLast = false }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(tool.tool)
  const hasOutput = !!tool.output

  return (
    <div className={cn(!isLast && "border-b border-border/30")}>
      <button
        onClick={() => hasOutput && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full text-left text-muted-foreground transition-colors",
          isMobile ? "px-3 py-2.5 text-sm touch-target" : "px-2.5 py-1.5 text-xs",
          hasOutput && "hover:text-foreground hover:bg-muted/50 cursor-pointer"
        )}
      >
        <Icon className={cn("shrink-0 text-muted-foreground", isMobile ? "h-4 w-4" : "h-3 w-3")} />
        <span className="flex-1 truncate">{tool.summary}</span>
        {hasOutput && (
          expanded ? (
            <ChevronDown className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          ) : (
            <ChevronRight className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          )
        )}
      </button>

      {expanded && tool.output && (
        <div className={cn(
          "border-t border-border/30 bg-muted/20",
          isMobile ? "px-3 py-2" : "px-2.5 py-1.5"
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
