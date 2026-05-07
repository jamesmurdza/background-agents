"use client"

import { useMemo, memo } from "react"
import { GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message } from "@/lib/types"
import {
  MarkdownContent,
  SystemMessage,
  ToolCallGroup,
  mergeConsecutiveToolCalls,
} from "./message"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  isMobile?: boolean
  repo?: string
  /** Called when the user clicks a tool-call row that references a file. */
  onOpenFile?: (filePath: string) => void
  /** Called when the user clicks the "force push" link in a push-failure message. */
  onForcePush?: () => void
  /** Called when the user clicks "View Plan" for a plan message. */
  onOpenPlan?: (messageId: string) => void
}

// Memoized MessageBubble to prevent re-renders when parent (ChatPanel) re-renders
// due to input changes. Only re-render when message content actually changes.
export const MessageBubble = memo(function MessageBubble({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush, onOpenPlan }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const hasUploadedFiles = isUser && message.uploadedFiles && message.uploadedFiles.length > 0

  return (
    <div
      className={cn("flex", isUser && "justify-end")}
      data-testid={isUser ? "user-message" : "assistant-message"}
      data-message-id={message.id}
      data-role={message.role}
    >
      {/* Content */}
      <div className={cn(
        !isUser && "w-full",
        isUser && (isMobile ? "max-w-[95%]" : "max-w-[90%]")
      )}>
        {isUser ? (
          <div className="min-w-0">
            <div className={cn(
              "inline-block rounded-lg bg-muted text-foreground text-left max-w-full min-w-0",
              isMobile ? "px-3 py-2 text-base" : "px-4 py-2 text-[15px]"
            )}>
              <MarkdownContent text={message.content} isMobile={isMobile} constrainWidth={false} />
            </div>
            {/* Uploaded files display */}
            {hasUploadedFiles && (
              <div className={cn(
                "mt-1 space-y-1 text-muted-foreground",
                isMobile ? "text-sm" : "text-[13px]"
              )}>
                {message.uploadedFiles!.map((filePath, index) => {
                  const fileName = filePath.split("/").pop() || filePath
                  return (
                    <div key={index} className="flex items-center gap-1 truncate">
                      <FileText className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "shrink-0")} />
                      {fileName}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <AssistantContent message={message} isStreaming={isStreaming} isMobile={isMobile} repo={repo} onOpenFile={onOpenFile} onForcePush={onForcePush} onOpenPlan={onOpenPlan} />
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for memo - only re-render when these change
  // This prevents re-renders when typing in the input (which causes ChatPanel to re-render)
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.toolCalls === nextProps.message.toolCalls &&
    prevProps.message.contentBlocks === nextProps.message.contentBlocks &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isMobile === nextProps.isMobile &&
    prevProps.repo === nextProps.repo
    // Note: onOpenFile and onForcePush are stable callbacks from parent
  )
})


// =============================================================================
// Assistant Content (with tool calls)
// =============================================================================

import { Brain } from "lucide-react"

function AssistantContent({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush, onOpenPlan }: { message: Message; isStreaming?: boolean; isMobile?: boolean; repo?: string; onOpenFile?: (filePath: string) => void; onForcePush?: () => void; onOpenPlan?: (messageId: string) => void }) {
  const hasContent = message.content && message.content.trim().length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0
  const isEmpty = !hasContent && !hasToolCalls && !hasBlocks
  const isGitOperation = message.messageType === "git-operation"

  if (isEmpty) {
    if (!isStreaming) return null
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
        repo={repo}
        linkBranch={message.linkBranch}
        metadata={message.metadata}
        onForcePush={onForcePush}
      />
    )
  }

  // Plan mode messages get a special stub
  if (message.metadata?.isPlan) {
    return (
      <div className={cn("w-full py-1", isMobile ? "text-base" : "text-[14px]")}>
        <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-card w-full max-w-2xl">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Brain className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">Execution plan</p>
            <p className="text-muted-foreground text-xs truncate">
              {isStreaming ? "Agent is generating a plan..." : "Ready for review"}
            </p>
          </div>
          <button
            onClick={() => onOpenPlan?.(message.id)}
            className="shrink-0 px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-accent text-foreground rounded-md transition-colors cursor-pointer"
          >
            View plan
          </button>
        </div>
        
        {/* Streaming indicator for the rest of the plan generation */}
        {isStreaming && (
          <div className="text-2xl text-muted-foreground animate-pulse mt-2 ml-1">
            ...
          </div>
        )}
      </div>
    )
  }

  // Merge consecutive tool_calls blocks into single groups (memoized to avoid recalculating on every render)
  const mergedBlocks = useMemo(() => {
    return hasBlocks ? mergeConsecutiveToolCalls(message.contentBlocks!) : null
  }, [hasBlocks, message.contentBlocks])

  return (
    <div className={cn(
      "w-full leading-relaxed",
      isMobile ? "space-y-4 text-base" : "space-y-3 text-[15px]"
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
                onOpenFile={onOpenFile}
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
              onOpenFile={onOpenFile}
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