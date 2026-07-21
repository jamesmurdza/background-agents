"use client"

import { useMemo, memo } from "react"
import { GitMerge, FileText, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message } from "@/lib/types"
import { basename } from "@/lib/format"
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
}

// Memoized MessageBubble to prevent re-renders when parent (ChatPanel) re-renders
// due to input changes. Only re-render when message content actually changes.
export const MessageBubble = memo(function MessageBubble({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush }: MessageBubbleProps) {
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
                  const fileName = basename(filePath)
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
          <AssistantContent message={message} isStreaming={isStreaming} isMobile={isMobile} repo={repo} onOpenFile={onOpenFile} onForcePush={onForcePush} />
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

function AssistantContent({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush }: { message: Message; isStreaming?: boolean; isMobile?: boolean; repo?: string; onOpenFile?: (filePath: string) => void; onForcePush?: () => void }) {
  const hasContent = message.content && message.content.trim().length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0
  const isEmpty = !hasContent && !hasToolCalls && !hasBlocks
  const isGitOperation = message.messageType === "git-operation"
  // Error messages (e.g. a failed send/agent run) are surfaced as a system
  // message rather than rendered as plain assistant markdown text.
  const isErrorMessage = message.messageType === "error" || (message.isError && !isGitOperation)

  // Error messages should still render even when they have no content yet.
  if (isEmpty && !isErrorMessage) {
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

  // Error messages also use the SystemMessage component, with an alert icon.
  if (isErrorMessage) {
    return (
      <SystemMessage
        icon={AlertTriangle}
        content={message.content || "Error"}
        variant="error"
        redText
        isMobile={isMobile}
      />
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