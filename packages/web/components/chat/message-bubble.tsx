"use client"

import { useState } from "react"
import { cn } from "@/lib/shared/utils"
import type { Agent, AssistantSource, Message, PushErrorInfo, ToolCall } from "@/lib/shared/types"
import { ASSISTANT_SOURCE } from "@/lib/shared/constants"
import { agentLabels } from "@/lib/shared/types"
import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  Terminal,
  FolderSearch,
  Regex,
  GitCommitHorizontal,
  GitBranch,
  RefreshCw,
  Loader2,
} from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { NoticeIcon, type NoticeIconType } from "@/components/icons/notice-icons"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ============================================================================
// Tool Call Components
// ============================================================================

function ToolCallIcon({ tool }: { tool: string }) {
  const cls = "h-3 w-3"
  switch (tool) {
    case "Read":
      return <FileText className={cls} />
    case "Edit":
      return <Pencil className={cls} />
    case "Write":
      return <FilePlus className={cls} />
    case "Glob":
      return <FolderSearch className={cls} />
    case "Grep":
      return <Regex className={cls} />
    case "Bash":
      return <Terminal className={cls} />
    case "Search":
      return <Search className={cls} />
    default:
      return <Terminal className={cls} />
  }
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="relative my-1.5 ml-[10px]">
      <div className="absolute left-[5.5px] top-2 bottom-2 w-px bg-border" />
      <div className="flex flex-col">
        {toolCalls.map((tc) => (
          <div key={tc.id} className="relative flex items-start gap-2.5 py-[5px] min-w-0">
            <div className="relative z-10 flex h-[12px] w-[12px] shrink-0 items-center justify-center text-muted-foreground mt-0.5">
              <ToolCallIcon tool={tc.tool} />
            </div>
            {tc.fullSummary ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground break-words min-w-0 cursor-help">
                    {tc.summary}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-md font-mono text-[10px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {tc.fullSummary}
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-xs text-muted-foreground break-words min-w-0">
                {tc.summary}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Notice Icon Content Processing
// ============================================================================

/** Pattern to match notice icon markers like ::icon-warning:: */
const NOTICE_ICON_PATTERN = /::icon-(warning|success|info|error)::/g

/**
 * Inline notice icon component rendered within text
 */
function InlineNoticeIcon({ type }: { type: NoticeIconType }) {
  return (
    <span className="inline-flex items-center align-middle mr-1.5">
      <NoticeIcon type={type} className="h-4 w-4" />
    </span>
  )
}

/**
 * Process text content and replace ::icon-*:: markers with React components
 */
function processContentWithIcons(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset the regex state
  NOTICE_ICON_PATTERN.lastIndex = 0

  while ((match = NOTICE_ICON_PATTERN.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    // Add the icon component
    const iconType = match[1] as NoticeIconType
    parts.push(<InlineNoticeIcon key={match.index} type={iconType} />)

    lastIndex = match.index + match[0].length
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [content]
}

// Markdown component customizations for proper list rendering
const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children, start }: { children?: React.ReactNode; start?: number }) => (
    <ol className="my-2 ml-4 list-decimal space-y-1" start={start}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="pl-1">{children}</li>
  ),
}

/**
 * Notice markdown components - extends base components with icon processing for paragraphs
 */
const noticeMarkdownComponents = {
  ...markdownComponents,
  p: ({ children }: { children?: React.ReactNode }) => {
    // Process children to handle icon markers in text nodes
    const processedChildren = React.Children.map(children, (child) => {
      if (typeof child === "string") {
        const processed = processContentWithIcons(child)
        // If processing resulted in just the original string, return it as-is
        if (processed.length === 1 && processed[0] === child) {
          return child
        }
        return <>{processed}</>
      }
      return child
    })
    return <p>{processedChildren}</p>
  },
  // Also handle strong tags since bold text is common in notices
  strong: ({ children }: { children?: React.ReactNode }) => {
    const processedChildren = React.Children.map(children, (child) => {
      if (typeof child === "string") {
        const processed = processContentWithIcons(child)
        if (processed.length === 1 && processed[0] === child) {
          return child
        }
        return <>{processed}</>
      }
      return child
    })
    return <strong>{processedChildren}</strong>
  },
}

/** Shared rounded yellow notice bubble (workspace markdown + push-retry UI). Lemon-leaning yellow-400/500 — less orange than yellow-600. */
const WORKSPACE_NOTICE_PANEL_CLASS =
  "rounded-lg bg-yellow-400/[0.11] dark:bg-yellow-500/[0.12] px-4 py-2.5 text-sm leading-relaxed text-yellow-950 dark:text-yellow-50 [&_p]:text-sm [&_p]:my-1 [&_p]:leading-relaxed [&_strong]:font-medium [&_a]:text-yellow-700 dark:[&_a]:text-yellow-300 [&_code]:rounded [&_code]:bg-yellow-500/14 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-yellow-900 dark:[&_code]:bg-yellow-500/18 dark:[&_code]:text-yellow-100"

function TextBlockContent({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 break-words overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full min-w-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >{text}</Markdown>
    </div>
  )
}

// ============================================================================
// Message Bubble Component
// ============================================================================

// ============================================================================
// Push Error Retry Component
// ============================================================================

interface PushErrorRetryProps {
  pushError: PushErrorInfo
  onRetry: (pushError: PushErrorInfo) => Promise<{ success: boolean; error?: string }>
  messageId: string
  onClearError: () => void
  /** Render inside parent notice panel (no second box); optional separator when markdown sits above */
  embedded?: boolean
  hasSeparator?: boolean
}

function PushErrorRetry({
  pushError,
  onRetry,
  messageId,
  onClearError,
  embedded = false,
  hasSeparator = false,
}: PushErrorRetryProps) {
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const handleRetry = async () => {
    setIsRetrying(true)
    setRetryError(null)
    try {
      const result = await onRetry(pushError)
      if (result.success) {
        onClearError()
      } else {
        setRetryError(result.error || "Retry failed")
      }
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed")
    } finally {
      setIsRetrying(false)
    }
  }

  const body = (
    <>
      <p className="text-sm mt-1.5 text-yellow-950/90 dark:text-yellow-50/90">
        You can force push to sync your changes:
      </p>
      {retryError && (
        <p className="text-sm mt-1.5 text-red-600 dark:text-red-400">{retryError}</p>
      )}
      <button
        type="button"
        onClick={handleRetry}
        disabled={isRetrying}
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-yellow-500/25 text-yellow-950 dark:text-yellow-50 hover:bg-yellow-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRetrying ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Force pushing...
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5 shrink-0" />
            Force push
          </>
        )}
      </button>
    </>
  )

  if (embedded) {
    return (
      <div className={cn(hasSeparator && "mt-3 pt-3 border-t border-yellow-500/20")}>{body}</div>
    )
  }

  return <div className={cn("mt-2", WORKSPACE_NOTICE_PANEL_CLASS)}>{body}</div>
}

// ============================================================================
// Message Bubble Component
// ============================================================================

interface MessageBubbleProps {
  message: Message
  agent?: Agent
  agentLabel?: string // Deprecated: use agent prop instead
  onCommitClick?: (hash: string, msg: string) => void
  onBranchFromCommit?: (hash: string) => void
  onRetryPush?: (pushError: PushErrorInfo) => Promise<{ success: boolean; error?: string }>
  onClearPushError?: (messageId: string) => void
}

function effectiveAssistantSource(message: Message): AssistantSource {
  if (message.role !== "assistant") return ASSISTANT_SOURCE.MODEL
  if (message.commitHash) return ASSISTANT_SOURCE.COMMIT
  return message.assistantSource ?? ASSISTANT_SOURCE.MODEL
}

export function MessageBubble({ message, agent = "claude-code", agentLabel, onCommitClick, onBranchFromCommit, onRetryPush, onClearPushError }: MessageBubbleProps) {
  // Use agent prop primarily, fall back to agentLabel for backwards compatibility
  const displayLabel = agentLabel || agentLabels[agent] || "Claude Code"
  const isUser = message.role === "user"
  const source = effectiveAssistantSource(message)
  const isSystemAssistant = !isUser && source === ASSISTANT_SOURCE.SYSTEM

  // Commit row rendering
  if (message.commitHash) {
    return (
      <div id={`commit-${message.commitHash}`} className="group/commitrow flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <button
          onClick={() => onCommitClick?.(message.commitHash!, message.commitMessage || "")}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:border-primary/30 transition-colors"
        >
          <GitCommitHorizontal className="h-3 w-3" />
          <code className="font-mono text-[10px] text-primary/70">{message.commitHash}</code>
          <span className="max-w-[200px] truncate">{message.commitMessage}</span>
        </button>
        <div className="relative h-px flex-1 bg-border">
          {onBranchFromCommit && (
            <button
              onClick={(e) => { e.stopPropagation(); onBranchFromCommit(message.commitHash!) }}
              title="Branch from here"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex px-2 cursor-pointer items-center justify-center bg-background text-muted-foreground hover:text-primary transition-colors"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0

  if (isSystemAssistant) {
    return (
      <div
        className="flex flex-col min-w-0 max-w-full"
        aria-label="Workspace message"
      >
        <span className="text-[10px] text-muted-foreground/40 mb-1">{message.timestamp}</span>
        <div className={WORKSPACE_NOTICE_PANEL_CLASS}>
          {message.content ? (
            <Markdown remarkPlugins={[remarkGfm]} components={noticeMarkdownComponents}>
              {message.content}
            </Markdown>
          ) : null}
          {message.pushError && onRetryPush && (
            <PushErrorRetry
              embedded
              hasSeparator={Boolean(message.content?.trim())}
              pushError={message.pushError}
              onRetry={onRetryPush}
              messageId={message.id}
              onClearError={() => onClearPushError?.(message.id)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-w-0 max-w-full">
      <div className="flex items-center gap-2 mb-1">
        {!isUser && (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/20">
            <AgentIcon agent={agent} className="h-3 w-3 text-primary" />
          </div>
        )}
        <span className={cn(
          "text-[11px] font-medium",
          isUser ? "text-muted-foreground" : "text-foreground"
        )}>
          {isUser ? "You" : displayLabel}
        </span>
        <span className="text-[10px] text-muted-foreground/40">{message.timestamp}</span>
      </div>

      {hasContentBlocks ? (
        <div className="flex flex-col gap-1 min-w-0 max-w-full">
          {message.contentBlocks!.map((block, idx) => {
            if (block.type === "text") {
              return <TextBlockContent key={idx} text={block.text} />
            } else if (block.type === "tool_calls") {
              const toolCallsWithIds = block.toolCalls.map((tc, tcIdx) => ({
                ...tc,
                id: tc.id || `tc-${idx}-${tcIdx}`,
                timestamp: tc.timestamp || "",
              }))
              return <ToolCallTimeline key={idx} toolCalls={toolCallsWithIds} />
            }
            return null
          })}
        </div>
      ) : (
        <>
          <div
            className={cn(
              "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "bg-primary/15 text-foreground whitespace-pre-wrap break-words"
                : "bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 break-words overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full min-w-0"
            )}
          >
            {message.content ? (
              isUser ? (
                message.content
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >{message.content}</Markdown>
              )
            ) : (
              message.role === "assistant" &&
              source === ASSISTANT_SOURCE.MODEL && (
                <span className="text-muted-foreground/50 italic">Thinking...</span>
              )
            )}
          </div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallTimeline toolCalls={message.toolCalls} />
          )}
        </>
      )}

      {/* Push error retry UI */}
      {message.pushError && onRetryPush && (
        <PushErrorRetry
          pushError={message.pushError}
          onRetry={onRetryPush}
          messageId={message.id}
          onClearError={() => onClearPushError?.(message.id)}
        />
      )}
    </div>
  )
}
