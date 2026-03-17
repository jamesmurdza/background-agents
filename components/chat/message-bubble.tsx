"use client"

import { cn } from "@/lib/utils"
import type { Agent, Message, ToolCall } from "@/lib/types"
import { agentLabels } from "@/lib/types"
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
} from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
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

function TextBlockContent({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 break-words overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full min-w-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >{text}</Markdown>
    </div>
  )
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
}

export function MessageBubble({ message, agent = "claude-code", agentLabel, onCommitClick, onBranchFromCommit }: MessageBubbleProps) {
  // Use agent prop primarily, fall back to agentLabel for backwards compatibility
  const displayLabel = agentLabel || agentLabels[agent] || "Claude Code"
  const isUser = message.role === "user"

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
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >{message.content}</Markdown>
              )
            ) : (
              message.role === "assistant" && (
                <span className="text-muted-foreground/50 italic">Thinking...</span>
              )
            )}
          </div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallTimeline toolCalls={message.toolCalls} />
          )}
        </>
      )}
    </div>
  )
}
